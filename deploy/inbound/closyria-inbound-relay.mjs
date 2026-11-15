#!/usr/bin/env node
// Reception relay for « Mes commandes par e-mail » (deploy/README.md, « Réception des e-mails de commande »).
//
// Postfix runs it (pipe transport, user closyria-mx) once per recipient of commandes.closyria.com (prod) or
// commandes.dev.closyria.com (dev):
//   closyria-inbound-relay.mjs <prod|dev> <queue_id> <sender> <client_address> <client_helo> <recipient>
// with the raw message on standard input (master.cf: null_sender= gives an empty sender for a bounce). It posts the message to the API of that environment, on 127.0.0.1
// (never through Caddy), signed with the environment's INBOUND_EMAIL_SECRET, read from
// /etc/closyria-inbound/<env>.secret (directory root:closyria-mx 750, file 640: /etc/closyria itself is root only). The API checks the signature, the sender (SPF, DKIM,
// alignment, computed by itself from the message and this envelope) and stores what it keeps.
//
// The signature is the same as apps/api/src/inbound/signature.ts (signature.test.ts runs this file against it):
// HMAC-SHA256 of `<timestamp>.<envelope header>.` followed by the body bytes.
//
// Exit codes (sysexits): 0 when the API answered 202 (whatever it decided: ignored e-mails get no reply), 413
// (too large) or 400 (malformed): dropped, no bounce; 75 (EX_TEMPFAIL) otherwise, so Postfix keeps the message and tries again later
// (API restarting, wrong secret). Never 5x: a bounce would answer the sender. Nothing of the message, the envelope
// or the secret is ever printed; Postfix logs only the short reason below, or `result=<what the API decided>` (queued,
// ignored, dropped…) on standard output after a 202.
//
// No dependency: Node's standard library only (it runs outside the application bundle).
//
// Postfix's systemd unit sets MemoryDenyWriteExecute=yes, so Node must run with --jitless (master.cf argv) and
// WebAssembly is unavailable: that is why this uses node:http and not fetch (undici parses HTTP with WebAssembly).
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { request } from "node:http";

const EX_OK = 0;
const EX_TEMPFAIL = 75;
/** The API refuses more (INBOUND_EMAIL_MAX_BYTES); Postfix's message_size_limit is a little lower. */
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 60_000;
const PORTS = { prod: 3001, dev: 3101 };

function done(code, reason) {
  if (reason) process.stderr.write(`closyria-inbound-relay: ${reason}\n`);
  process.exit(code);
}

async function readStdin(limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** POST over plain HTTP (127.0.0.1 only); resolves with the status and, for a 202, the body text. */
function post(url, headers, body) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "POST", headers: { ...headers, "content-length": body.length } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status !== 202) {
        res.resume();
        res.on("end", () => resolve({ status, text: "" }));
        return;
      }
      const parts = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size <= 4096) parts.push(chunk);
      });
      res.on("end", () => resolve({ status, text: Buffer.concat(parts).toString("utf8") }));
      res.on("error", reject);
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

async function main() {
  const [env, queueId = "", sender = "", clientIp = "", helo = "", recipient = ""] = process.argv.slice(2);
  if (!Object.hasOwn(PORTS, env)) return done(EX_TEMPFAIL, "unknown environment");
  // Tests only: Postfix's pipe gives a clean environment, so these cannot come from a sender.
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: test override, never set by turbo nor by Postfix.
  const url = process.env.CLOSYRIA_INBOUND_URL ?? `http://127.0.0.1:${PORTS[env]}/api/inbound-email`;
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: test override, never set by turbo nor by Postfix.
  const secretFile = process.env.CLOSYRIA_INBOUND_SECRET_FILE ?? `/etc/closyria-inbound/${env}.secret`;
  let secret;
  try {
    secret = readFileSync(secretFile, "utf8").trim();
  } catch {
    return done(EX_TEMPFAIL, "secret file unreadable");
  }
  if (!/^[0-9a-f]{64}$/.test(secret)) return done(EX_TEMPFAIL, "secret file malformed");

  const body = await readStdin(MAX_BYTES);
  if (body === null) return done(EX_OK, "message too large, dropped");

  const envelope = Buffer.from(
    JSON.stringify({ v: 1, queueId, mailFrom: sender, rcptTo: recipient, clientIp, helo }),
    "utf8",
  ).toString("base64url");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret).update(`${timestamp}.${envelope}.`, "utf8").update(body).digest("hex");

  let status;
  let result = "";
  try {
    const response = await post(
      url,
      {
        "content-type": "message/rfc822",
        "x-closyria-envelope": envelope,
        "x-closyria-timestamp": timestamp,
        "x-closyria-signature": `v1=${signature}`,
      },
      body,
    );
    status = response.status;
    if (status === 202) {
      let answer = {};
      try {
        answer = JSON.parse(response.text);
      } catch {}
      result = typeof answer?.result === "string" && /^[a-z]{1,20}$/.test(answer.result) ? answer.result : "?";
    }
  } catch {
    return done(EX_TEMPFAIL, "API unreachable");
  }
  if (status === 202) {
    process.stdout.write(`result=${result}\n`);
    return done(EX_OK);
  }
  if (status === 413) return done(EX_OK, "message too large for the API, dropped");
  // Malformed (an envelope the API refuses): trying again would not change it.
  if (status === 400) return done(EX_OK, "refused as malformed, dropped");
  return done(EX_TEMPFAIL, `API answered ${status}`);
}

main().catch(() => done(EX_TEMPFAIL, "unexpected error"));
