import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * How the reception relay (deploy/inbound/closyria-inbound-relay.mjs, run by Postfix on the server) hands an e-mail
 * to the API: the raw message as the body, the SMTP envelope in `X-Closyria-Envelope` (base64url JSON), the time in
 * `X-Closyria-Timestamp` (Unix seconds) and `X-Closyria-Signature: v1=<hex>`, the HMAC-SHA256 with
 * INBOUND_EMAIL_SECRET of `<timestamp>.<envelope header>.` followed by the body bytes. The relay keeps its own copy of
 * this code (it runs outside the bundle): change both together, signature.test.ts runs the relay against this one.
 */
export const ENVELOPE_HEADER = "x-closyria-envelope";
export const TIMESTAMP_HEADER = "x-closyria-timestamp";
export const SIGNATURE_HEADER = "x-closyria-signature";
/** A signed request is valid this long (either way: the clocks of the relay and the API are the same machine's). */
export const SIGNATURE_TOLERANCE_S = 300;

const MAX_ADDRESS = 320;

/**
 * The SMTP envelope Postfix saw: its queue id (with the recipient, what makes a retry idempotent), MAIL FROM (empty for
 * a bounce), the one recipient, the client's address and HELO.
 */
export const envelopeSchema = z
  .object({
    v: z.literal(1),
    queueId: z.string().regex(/^[0-9A-Za-z]{5,32}$/),
    mailFrom: z.string().max(MAX_ADDRESS),
    rcptTo: z.string().min(3).max(MAX_ADDRESS),
    clientIp: z.union([z.ipv4(), z.ipv6()]),
    helo: z.string().max(255),
  })
  .strict();
export type Envelope = z.infer<typeof envelopeSchema>;

export function encodeEnvelope(envelope: Envelope): string {
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
}

export function decodeEnvelope(header: string): Envelope | null {
  if (header.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(header)) return null;
  try {
    const parsed = envelopeSchema.safeParse(JSON.parse(Buffer.from(header, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function mac(secret: string, timestamp: string, envelopeHeader: string, body: Uint8Array): Buffer {
  return createHmac("sha256", secret).update(`${timestamp}.${envelopeHeader}.`, "utf8").update(body).digest();
}

/** The three headers of a request (the relay's side; tests use it too). */
export function signRequest(secret: string, envelope: Envelope, body: Uint8Array, nowS: number) {
  const envelopeHeader = encodeEnvelope(envelope);
  const timestamp = String(nowS);
  return {
    [ENVELOPE_HEADER]: envelopeHeader,
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: `v1=${mac(secret, timestamp, envelopeHeader, body).toString("hex")}`,
  };
}

/**
 * True when the signature is the secret's, over these exact headers and body, and the time is within the tolerance.
 * The two digests have the same length and are compared in constant time.
 */
export function verifySignature(
  secret: string,
  headers: { envelope: string | undefined; timestamp: string | undefined; signature: string | undefined },
  body: Uint8Array,
  nowS: number,
): boolean {
  const { envelope, timestamp, signature } = headers;
  if (!envelope || !timestamp || !signature) return false;
  if (!/^\d{1,12}$/.test(timestamp) || Math.abs(nowS - Number(timestamp)) > SIGNATURE_TOLERANCE_S) return false;
  const given = /^v1=([0-9a-f]{64})$/.exec(signature)?.[1];
  if (!given) return false;
  return timingSafeEqual(Buffer.from(given, "hex"), mac(secret, timestamp, envelope, body));
}
