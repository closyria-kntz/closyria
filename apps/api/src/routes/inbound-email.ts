import { INBOUND_EMAIL_MAX_BYTES } from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { type AccessEnv, defineAccess } from "../access";
import { type InboundDeps, receiveInboundEmail } from "../inbound/receive";
import {
  decodeEnvelope,
  ENVELOPE_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifySignature,
} from "../inbound/signature";

/** E-mail reception (INBOUND_EMAIL_SECRET set). Without the secret, the route does not exist (404). */
export type InboundEmailDeps = InboundDeps & {
  secret: string;
  /** Clock of the signature check (Unix seconds), injectable for tests. */
  nowS?: () => number;
};

const resultSchema = z.object({
  result: z.enum(["queued", "ignored", "confirmation", "duplicate", "dropped", "failed"]),
});
const errorSchema = z.object({ error: z.string() });
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});

const route = defineAccess(
  createRoute({
    method: "post",
    path: "/inbound-email",
    summary: "An e-mail received on an order address (from the server's reception relay only)",
    description:
      "Called by deploy/inbound/closyria-inbound-relay.mjs, which Postfix runs for each recipient on 127.0.0.1, " +
      "never through Caddy: a request that went through a proxy (`X-Forwarded-For`) is answered 404, as when " +
      "INBOUND_EMAIL_SECRET is not set. Body: the raw message (`message/rfc822`, 2 MB at most). Headers: the SMTP " +
      "envelope (`X-Closyria-Envelope`), `X-Closyria-Timestamp` and `X-Closyria-Signature` (HMAC-SHA256 with " +
      "INBOUND_EMAIL_SECRET, see inbound/signature.ts). Accepted only when the effective sender is her verified " +
      "address, authenticated as computed here (inbound/sender.ts); otherwise ignored, without any reply. A DNS " +
      "failure answers 503 so that Postfix tries again; the same delivery twice (queue id) is a duplicate.",
    middleware: [
      // Proxied: not the local relay. Answered like a missing route, before anything is read.
      async (c, next) => (c.req.header("x-forwarded-for") ? c.json({ error: "not_found" }, 404) : next()),
      bodyLimit({ maxSize: INBOUND_EMAIL_MAX_BYTES, onError: (c) => c.json({ error: "too_large" }, 413) }),
    ],
    responses: {
      202: { description: "Handled (whatever the outcome)", content: { "application/json": { schema: resultSchema } } },
      400: errorContent("Not a raw message, or a malformed envelope (invalid_request)"),
      401: errorContent("Missing, stale or wrong signature (invalid_signature)"),
      404: errorContent("Reception is off, or the request came through a proxy (not_found)"),
      413: errorContent("Larger than 2 MB (too_large): nothing is stored"),
      503: errorContent("The DNS did not answer the checks (temporary): nothing stored, the relay tries again"),
    },
  }),
  "public",
);

export function inboundEmailRoutes(deps: InboundEmailDeps) {
  const app = new OpenAPIHono<AccessEnv>();
  // The body and the envelope are never logged: only the error's name.
  app.onError((error, c) => {
    if (error instanceof HTTPException) return c.json({ error: "invalid_request" }, 400);
    console.error(`inbound e-mail: request failed (${error instanceof Error ? error.name : "error"})`);
    return c.json({ error: "internal" }, 500);
  });
  return app.openapi(route, async (c) => {
    const body = new Uint8Array(await c.req.arrayBuffer());
    const nowS = deps.nowS?.() ?? Math.floor(Date.now() / 1000);
    const headers = {
      envelope: c.req.header(ENVELOPE_HEADER),
      timestamp: c.req.header(TIMESTAMP_HEADER),
      signature: c.req.header(SIGNATURE_HEADER),
    };
    if (!verifySignature(deps.secret, headers, body, nowS)) return c.json({ error: "invalid_signature" }, 401);
    const envelope = decodeEnvelope(headers.envelope ?? "");
    const type = c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (!envelope || type !== "message/rfc822" || body.length === 0) return c.json({ error: "invalid_request" }, 400);
    const result = await receiveInboundEmail(deps, { raw: Buffer.from(body), envelope });
    if (result === "retry") return c.json({ error: "temporary" }, 503);
    return c.json({ result }, 202);
  });
}
