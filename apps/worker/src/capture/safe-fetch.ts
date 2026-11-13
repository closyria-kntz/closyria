import dns, { type LookupAddress, type LookupOptions } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream";
import { createBrotliDecompress, createGunzip } from "node:zlib";
import { type AddressPolicy, strictPolicy } from "./address-policy";
import { CaptureError } from "./capture-error";

export const BOT_USER_AGENT = "Mozilla/5.0 (compatible; ClosyriaBot/1.0; +https://closyria.com)";
export const MAX_URL_LENGTH = 2_048;
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_REDIRECTS = 5;

/** The cause of an `invalid_data` failure when the answer was of another type than asked (`mime`, lower case). */
export class WrongContentType extends Error {
  constructor(readonly mime: string) {
    super(`unexpected content type ${mime}`);
    this.name = "WrongContentType";
  }
}

/** Whether a failure is an HTML page answered where JSON (or another type) was asked. */
export function isHtmlAnswer(error: unknown): boolean {
  return (
    error instanceof CaptureError &&
    error.code === "invalid_data" &&
    error.cause instanceof WrongContentType &&
    ACCEPTED_TYPES.page(error.cause.mime)
  );
}

export type SafeFetchAccept = "page" | "json" | "image" | "text" | "xml";

export type SafeFetchOptions = {
  /** Strict by default. Never read from the environment. */
  policy?: AddressPolicy;
  accept: SafeFetchAccept;
  /** Cap on the body, counted after decompression. */
  maxBytes?: number;
  /** One deadline for the whole call: DNS, connections, redirects and body. */
  timeoutMs?: number;
  maxRedirects?: number;
  /** Injectable resolver (tests). Called with `{ all: true }`. */
  lookup?: typeof dns.lookup;
  /** Gives up at once when aborted (a worker stopping), like the deadline: a `timeout` CaptureError. */
  signal?: AbortSignal;
  /** Headers of the answer to give back (lower case), e.g. a WooCommerce listing's `x-wp-total`. */
  keepHeaders?: readonly string[];
};

export type SafeResponse = {
  finalUrl: string;
  status: number;
  contentType: string;
  body: Buffer;
  /** The answer's headers named in `keepHeaders` (lower case), when it names any. */
  headers?: Record<string, string>;
};

const ACCEPT_HEADER: Record<SafeFetchAccept, string> = {
  page: "text/html,application/xhtml+xml;q=0.9",
  json: "application/json,text/javascript;q=0.9",
  image: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
  text: "text/plain",
  xml: "application/xml,text/xml;q=0.9",
};

const ACCEPTED_TYPES: Record<SafeFetchAccept, (mime: string) => boolean> = {
  page: (mime) => mime === "text/html" || mime === "application/xhtml+xml",
  // Shopify serves `/products/<handle>.js` as JSON under a JavaScript type.
  json: (mime) => mime === "application/json" || mime === "text/javascript" || mime === "application/javascript",
  // Raster images only: the photo pipeline re-encodes them, SVG would carry markup and scripts.
  image: (mime) => /^image\/[a-z0-9][a-z0-9.+-]*$/.test(mime) && !mime.startsWith("image/svg"),
  // Plain text only (robots.txt); the charset parameter is ignored by `mimeOf`.
  text: (mime) => mime === "text/plain",
  // Sitemaps.
  xml: (mime) => mime === "application/xml" || mime === "text/xml",
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** 430: Shopify's security rejection (« too many requests » from its edge), a block like 429. */
const BLOCKED_STATUSES = new Set([401, 403, 429, 430]);
const CHALLENGE_MARKERS = ["captcha-delivery", "cf-chl", "_incapsula_"];
const CHALLENGE_SCAN_BYTES = 64 * 1024;
const STANDARD_PORTS = new Set([80, 443]);
const LOOPBACK = "127.0.0.1";

type Hop = {
  policy: AddressPolicy;
  resolver: typeof dns.lookup;
  accept: SafeFetchAccept;
  signal: AbortSignal;
};

function forbidden(): CaptureError {
  return new CaptureError("forbidden_address");
}

/** Scheme, credentials, length and port rules of spec §8; the address itself is checked later. */
function checkUrl(raw: string, policy: AddressPolicy, base?: URL): URL {
  if (raw.length > MAX_URL_LENGTH) throw forbidden();
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    throw forbidden();
  }
  if (url.href.length > MAX_URL_LENGTH) throw forbidden();
  if (url.protocol !== "http:" && url.protocol !== "https:") throw forbidden();
  if (url.username !== "" || url.password !== "") throw forbidden();
  if (!STANDARD_PORTS.has(portOf(url)) && !policy.anyPortOnLoopback) throw forbidden();
  return url;
}

function portOf(url: URL): number {
  if (url.port !== "") return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

/** WHATWG keeps the brackets of IPv6 literals in `hostname`. */
function bareHost(url: URL): string {
  return url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
}

/** Address rule for one connection target; a non-standard port is only for the test policy on 127.0.0.1. */
function addressAllowed(address: string, policy: AddressPolicy, standardPort: boolean): boolean {
  if (!policy(address)) return false;
  return standardPort || (policy.anyPortOnLoopback === true && address === LOOPBACK);
}

function wantedFamily(family: LookupOptions["family"]): 0 | 4 | 6 {
  if (family === 4 || family === "IPv4") return 4;
  if (family === 6 || family === "IPv6") return 6;
  return 0;
}

/**
 * The `lookup` given to the socket: resolves every address once, refuses the connection if any of
 * them is forbidden, then hands back only vetted addresses so the socket connects to what was
 * checked, with no second resolution.
 */
function vettedLookup(hop: Hop, standardPort: boolean, onRefused: (error: CaptureError) => void): LookupFunction {
  return (hostname, options, callback) => {
    const fail = (error: NodeJS.ErrnoException) => {
      if (error instanceof CaptureError) onRefused(error);
      if (options.all) callback(error, []);
      else callback(error, "", 0);
    };
    const vet = (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => {
      if (error) return fail(error);
      if (addresses.length === 0) return fail(new CaptureError("http_error"));
      if (addresses.some(({ address }) => !addressAllowed(address, hop.policy, standardPort))) {
        return fail(forbidden());
      }
      const family = wantedFamily(options.family);
      const usable = family === 0 ? addresses : addresses.filter((entry) => entry.family === family);
      const [first] = usable;
      if (!first) return fail(new CaptureError("http_error"));
      if (options.all) callback(null, usable);
      else callback(null, first.address, first.family);
    };
    try {
      hop.resolver(hostname, { all: true }, vet);
    } catch (error) {
      // A resolver that throws must not escape as an uncaught exception from the socket.
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  };
}

function request(url: URL, hop: Hop): Promise<IncomingMessage> {
  const host = bareHost(url);
  const port = portOf(url);
  const standardPort = STANDARD_PORTS.has(port);
  const literal = isIP(host) !== 0;
  // Node skips `lookup` for IP literals: check them here.
  if (literal && !addressAllowed(host, hop.policy, standardPort)) return Promise.reject(forbidden());

  return new Promise((resolve, reject) => {
    let refusal: CaptureError | undefined;
    const client = url.protocol === "https:" ? https : http;
    const req = client.request({
      protocol: url.protocol,
      hostname: host,
      port,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      // No cookie, ever; Host and TLS SNI stay on the original host name.
      headers: {
        "user-agent": BOT_USER_AGENT,
        accept: ACCEPT_HEADER[hop.accept],
        "accept-encoding": "gzip, br",
      },
      ...(literal ? {} : { lookup: vettedLookup(hop, standardPort, (error) => (refusal = error)) }),
      ...(url.protocol === "https:" && !literal ? { servername: host } : {}),
      // A fresh connection per request: no socket reused from another resolution.
      agent: false,
      signal: hop.signal,
    });
    req.once("response", resolve);
    req.once("error", (error) => {
      if (refusal) reject(refusal);
      else if (error instanceof CaptureError) reject(error);
      else reject(new CaptureError(hop.signal.aborted ? "timeout" : "http_error", undefined, { cause: error }));
    });
    req.end();
  });
}

function decoderFor(encoding: string): Readable & NodeJS.WritableStream {
  switch (encoding) {
    case "gzip":
    case "x-gzip":
      return createGunzip();
    case "br":
      return createBrotliDecompress();
    default:
      throw new CaptureError("invalid_data");
  }
}

/**
 * Reads the body, decompressed, and stops as soon as it exceeds `maxBytes`. With `headOnly`, stops
 * quietly after `maxBytes` and returns what was read (challenge detection on error pages).
 */
async function readBody(res: IncomingMessage, maxBytes: number, headOnly = false): Promise<Buffer> {
  const encoding = (res.headers["content-encoding"] ?? "").trim().toLowerCase();
  const plain = encoding === "" || encoding === "identity";
  if (!headOnly && plain && Number(res.headers["content-length"]) > maxBytes) {
    res.destroy();
    throw new CaptureError("too_large");
  }
  let transportFailed = false;
  res.once("error", () => {
    transportFailed = true;
  });
  let stream: Readable = res;
  if (!plain) {
    let decoder: Readable & NodeJS.WritableStream;
    try {
      decoder = decoderFor(encoding);
    } catch (error) {
      res.destroy();
      throw error;
    }
    stream = decoder;
    pipeline(res, decoder, () => {});
  }

  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const buffer = chunk as Buffer;
      if (headOnly && total + buffer.length >= maxBytes) {
        chunks.push(buffer.subarray(0, maxBytes - total));
        total = maxBytes;
        break;
      }
      total += buffer.length;
      if (total > maxBytes) throw new CaptureError("too_large");
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof CaptureError) throw error;
    throw new CaptureError(transportFailed ? "http_error" : "invalid_data", undefined, { cause: error });
  } finally {
    stream.destroy();
    res.destroy();
  }
  return Buffer.concat(chunks, total);
}

function mimeOf(contentType: string): string {
  return (contentType.split(";")[0] ?? "").trim().toLowerCase();
}

function isChallenge(body: Buffer): boolean {
  const head = body.subarray(0, CHALLENGE_SCAN_BYTES).toString("latin1");
  return CHALLENGE_MARKERS.some((marker) => head.includes(marker));
}

async function run(rawUrl: string, options: SafeFetchOptions, signal: AbortSignal): Promise<SafeResponse> {
  const policy = options.policy ?? strictPolicy;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const hop: Hop = { policy, resolver: options.lookup ?? dns.lookup, accept: options.accept, signal };

  let url = checkUrl(rawUrl, policy);
  for (let redirects = 0; ; redirects++) {
    const res = await request(url, hop);
    const status = res.statusCode ?? 0;
    if (REDIRECT_STATUSES.has(status)) {
      res.destroy();
      const location = res.headers.location;
      if (!location || redirects >= maxRedirects) throw new CaptureError("http_error", status);
      url = checkUrl(location, policy, url);
      continue;
    }
    if (status < 200 || status >= 300) {
      const code = BLOCKED_STATUSES.has(status) ? "blocked" : "http_error";
      if (code === "http_error" && ACCEPTED_TYPES.page(mimeOf(res.headers["content-type"] ?? ""))) {
        // A challenge served with an error status (503 from Cloudflare, DataDome...) is a block.
        const head = await readBody(res, Math.min(CHALLENGE_SCAN_BYTES, maxBytes), true).catch(() => Buffer.alloc(0));
        if (isChallenge(head)) throw new CaptureError("blocked", status);
      }
      res.destroy();
      throw new CaptureError(code, status);
    }
    const contentType = res.headers["content-type"] ?? "";
    const mime = mimeOf(contentType);
    if (!ACCEPTED_TYPES[options.accept](mime)) {
      res.destroy();
      // The type answered, for a caller that tells an HTML page apart (a WooCommerce endpoint answering a page).
      throw new CaptureError("invalid_data", status, { cause: new WrongContentType(mime) });
    }
    const body = await readBody(res, maxBytes);
    if (ACCEPTED_TYPES.page(mime) && isChallenge(body)) throw new CaptureError("blocked", status);
    if (!options.keepHeaders?.length) return { finalUrl: url.href, status, contentType, body };
    const headers: Record<string, string> = {};
    for (const name of options.keepHeaders) {
      const value = res.headers[name];
      const first = Array.isArray(value) ? value[0] : value;
      if (first !== undefined) headers[name] = first;
    }
    return { finalUrl: url.href, status, contentType, body, headers };
  }
}

/**
 * The only way the worker fetches third-party URLs: address policy on every resolved address and
 * every redirect, http(s) on ports 80/443 only, no credentials, no cookies, size and time caps.
 */
export async function safeFetch(url: string, options: SafeFetchOptions): Promise<SafeResponse> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const external = options.signal;
  let onAbort: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    const giveUp = () => {
      reject(new CaptureError("timeout"));
      controller.abort();
    };
    timer = setTimeout(giveUp, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (external?.aborted) giveUp();
    else if (external) {
      onAbort = giveUp;
      external.addEventListener("abort", onAbort, { once: true });
    }
  });
  // Whatever escapes (a synchronous throw, a resolver failure) surfaces as a CaptureError.
  const work = run(url, options, controller.signal).catch((error: unknown) => {
    throw error instanceof CaptureError ? error : new CaptureError("http_error", undefined, { cause: error });
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    if (onAbort) external?.removeEventListener("abort", onAbort);
    controller.abort();
  }
}
