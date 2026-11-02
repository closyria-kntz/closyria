import { createHash, randomBytes } from "node:crypto";
import { lastForwardedAddress } from "@closyria/shared";
import type { Context, Env, MiddlewareHandler } from "hono";

export type RateLimitOptions<E extends Env = Env> = {
  max: number;
  windowMs: number;
  /** What is counted. Default: the client address (see the trust assumption below). */
  key?: (c: Context<E>) => string;
  /** Cap on tracked clients (default 10 000); the oldest are evicted first. */
  maxClients?: number;
};

const DEFAULT_MAX_TRACKED_CLIENTS = 10_000;

/**
 * Fixed-window limit per client, kept in the memory of the process (a restart resets it; with several API
 * processes each counts on its own — acceptable for abuse protection, to be revisited with a shared store).
 * The address is behind a one-way hash salted with a per-process random secret and is never written to a log,
 * a file or the database: only counters live here, and only for one window.
 *
 * TRUST ASSUMPTION: the client is the last `X-Forwarded-For` entry. That is only safe because the API listens
 * on 127.0.0.1 behind Caddy, which overwrites `X-Forwarded-For` with the address it saw, and the web server
 * (also on 127.0.0.1, behind Caddy) passes that address on for its server-side calls (see deploy/README.md).
 * Neither the API nor the web server may be exposed directly: a client could then pick its own bucket.
 */
export function rateLimit<E extends Env = Env>(
  options: RateLimitOptions<E>,
  onLimited: (c: Context<E>) => Response,
  now: () => number = Date.now,
): MiddlewareHandler<E> {
  const salt = randomBytes(16);
  const cap = options.maxClients ?? DEFAULT_MAX_TRACKED_CLIENTS;
  const windows = new Map<string, { count: number; resetAt: number }>();

  return async (c, next) => {
    const t = now();
    const key = createHash("sha256")
      .update(salt)
      .update(options.key ? options.key(c) : clientAddress(c.req.raw.headers))
      .digest("base64");
    let w = windows.get(key);
    if (!w || w.resetAt <= t) {
      windows.delete(key); // a renewed window goes to the back of the eviction order
      if (windows.size >= cap) {
        for (const [k, other] of windows) if (other.resetAt <= t) windows.delete(k);
        // Still full: evict the oldest entries (Map keeps insertion order), so a flood of distinct keys
        // pushes out the oldest counters one by one instead of resetting everybody's.
        for (const k of windows.keys()) {
          if (windows.size < cap) break;
          windows.delete(k);
        }
      }
      w = { count: 0, resetAt: t + options.windowMs };
      windows.set(key, w);
    }
    w.count += 1;
    if (w.count > options.max) return onLimited(c);
    await next();
  };
}

/** The last `X-Forwarded-For` entry, set by Caddy (see the trust assumption above). Without it: one shared bucket. */
function clientAddress(headers: Headers): string {
  return lastForwardedAddress(headers.get("x-forwarded-for")) ?? "unknown";
}
