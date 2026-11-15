import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  decodeEnvelope,
  ENVELOPE_HEADER,
  type Envelope,
  encodeEnvelope,
  SIGNATURE_HEADER,
  SIGNATURE_TOLERANCE_S,
  signRequest,
  TIMESTAMP_HEADER,
  verifySignature,
} from "./signature";

const SECRET = "0123456789abcdef".repeat(4);
const OTHER = "fedcba9876543210".repeat(4);
const NOW = 1_794_000_000;
const envelope: Envelope = {
  v: 1,
  queueId: "4QxR2T0b9zK",
  mailFrom: "marie.test@gmail.example",
  rcptTo: "marie-k7f2@commandes.dev.closyria.com",
  clientIp: "198.51.100.17",
  helo: "mail-wr1-f41.gmail.example",
};
const body = Buffer.from("From: Marie <marie.test@gmail.example>\r\n\r\nBonjour\r\n");

const headersOf = (h: Record<string, string>) => ({
  envelope: h[ENVELOPE_HEADER],
  timestamp: h[TIMESTAMP_HEADER],
  signature: h[SIGNATURE_HEADER],
});

describe("request signature", () => {
  it("verifies its own signature", () => {
    expect(verifySignature(SECRET, headersOf(signRequest(SECRET, envelope, body, NOW)), body, NOW)).toBe(true);
  });

  it("refuses another secret, a changed body, envelope or time", () => {
    const h = headersOf(signRequest(SECRET, envelope, body, NOW));
    expect(verifySignature(OTHER, h, body, NOW)).toBe(false);
    expect(verifySignature(SECRET, h, Buffer.concat([body, Buffer.from("x")]), NOW)).toBe(false);
    const otherEnvelope = encodeEnvelope({ ...envelope, mailFrom: "sophie@gmail.example" });
    expect(verifySignature(SECRET, { ...h, envelope: otherEnvelope }, body, NOW)).toBe(false);
    expect(verifySignature(SECRET, { ...h, timestamp: String(NOW + 1) }, body, NOW)).toBe(false);
  });

  it("refuses a stale or future request, beyond the tolerance", () => {
    const old = headersOf(signRequest(SECRET, envelope, body, NOW - SIGNATURE_TOLERANCE_S - 1));
    expect(verifySignature(SECRET, old, body, NOW)).toBe(false);
    const edge = headersOf(signRequest(SECRET, envelope, body, NOW - SIGNATURE_TOLERANCE_S));
    expect(verifySignature(SECRET, edge, body, NOW)).toBe(true);
    const future = headersOf(signRequest(SECRET, envelope, body, NOW + SIGNATURE_TOLERANCE_S + 1));
    expect(verifySignature(SECRET, future, body, NOW)).toBe(false);
  });

  it("refuses missing or malformed headers", () => {
    const h = headersOf(signRequest(SECRET, envelope, body, NOW));
    expect(verifySignature(SECRET, { ...h, signature: undefined }, body, NOW)).toBe(false);
    expect(verifySignature(SECRET, { ...h, envelope: undefined }, body, NOW)).toBe(false);
    expect(verifySignature(SECRET, { ...h, timestamp: "soon" }, body, NOW)).toBe(false);
    expect(verifySignature(SECRET, { ...h, signature: (h.signature ?? "").replace("v1=", "") }, body, NOW)).toBe(false);
    expect(verifySignature(SECRET, { ...h, signature: `${h.signature}00` }, body, NOW)).toBe(false);
    expect(verifySignature(SECRET, { ...h, signature: `v1=${"0".repeat(64)}` }, body, NOW)).toBe(false);
  });

  it("decodes only a well-formed envelope", () => {
    expect(decodeEnvelope(encodeEnvelope(envelope))).toEqual(envelope);
    expect(decodeEnvelope(encodeEnvelope({ ...envelope, mailFrom: "" }))?.mailFrom).toBe("");
    const bad = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    expect(decodeEnvelope(bad({ ...envelope, clientIp: "unknown" }))).toBeNull();
    expect(decodeEnvelope(bad({ ...envelope, v: 2 }))).toBeNull();
    expect(decodeEnvelope(bad({ ...envelope, queueId: "../x" }))).toBeNull();
    const { queueId: _q, ...withoutQueueId } = envelope;
    expect(decodeEnvelope(bad(withoutQueueId))).toBeNull();
    expect(decodeEnvelope(bad({ ...envelope, extra: 1 }))).toBeNull();
    expect(decodeEnvelope("not base64url!")).toBeNull();
    expect(decodeEnvelope(Buffer.from("{").toString("base64url"))).toBeNull();
  });
});

describe("the relay Postfix runs (deploy/inbound/closyria-inbound-relay.mjs)", () => {
  const relay = resolve(import.meta.dirname, "../../../../deploy/inbound/closyria-inbound-relay.mjs");
  const dir = mkdtempSync(join(tmpdir(), "closyria-relay-"));
  const secretFile = join(dir, "dev.secret");
  writeFileSync(secretFile, `${SECRET}\n`);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** Runs the relay against a local server answering `status`; returns its exit code and what the server got. */
  async function run(status: number, args: string[], input: Buffer, secretPath = secretFile) {
    let got: { headers: IncomingMessage["headers"]; body: Buffer } | undefined;
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        got = { headers: req.headers, body: Buffer.concat(chunks) };
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ result: "dropped" }));
      });
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const { port } = server.address() as AddressInfo;
    const child = spawn(process.execPath, [relay, ...args], {
      env: {
        CLOSYRIA_INBOUND_URL: `http://127.0.0.1:${port}/api/inbound-email`,
        CLOSYRIA_INBOUND_SECRET_FILE: secretPath,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.stdin.end(input);
    const code = await new Promise<number | null>((ok) => child.on("close", ok));
    server.close();
    return { code, got, stderr, stdout };
  }

  const args = ["dev", envelope.queueId, envelope.mailFrom, envelope.clientIp, envelope.helo, envelope.rcptTo];

  it("signs exactly as the API verifies, with the envelope Postfix gave", async () => {
    const { code, got, stderr, stdout } = await run(202, args, body);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe("result=dropped\n");
    if (!got) throw new Error("nothing received");
    expect(got.headers["content-type"]).toBe("message/rfc822");
    expect(got.body.equals(body)).toBe(true);
    const h = {
      envelope: got.headers[ENVELOPE_HEADER] as string,
      timestamp: got.headers[TIMESTAMP_HEADER] as string,
      signature: got.headers[SIGNATURE_HEADER] as string,
    };
    expect(decodeEnvelope(h.envelope)).toEqual(envelope);
    expect(verifySignature(SECRET, h, got.body, Math.floor(Date.now() / 1000))).toBe(true);
  });

  it("asks Postfix to try again when the API refuses, is away or the DNS failed (503), never to bounce", async () => {
    expect((await run(401, args, body)).code).toBe(75);
    expect((await run(503, args, body)).code).toBe(75);
    expect((await run(500, args, body)).code).toBe(75);
    expect((await run(404, args, body)).code).toBe(75);
    expect((await run(202, args, body, join(dir, "missing.secret"))).code).toBe(75);
  });

  it("drops a message the API will never take (too large, malformed), without a bounce", async () => {
    expect((await run(413, args, body)).code).toBe(0);
    expect((await run(400, args, body)).code).toBe(0);
    const { code, got } = await run(202, args, Buffer.alloc(2 * 1024 * 1024 + 1, 0x61));
    expect(code).toBe(0);
    expect(got).toBeUndefined();
  });

  it("prints nothing of the message, the envelope or the secret", async () => {
    const { stderr } = await run(401, args, body);
    for (const secretPart of [SECRET, envelope.mailFrom, envelope.rcptTo, "Bonjour"]) {
      expect(stderr).not.toContain(secretPart);
    }
  });
});
