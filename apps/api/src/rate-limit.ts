import { createHash, randomBytes } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";

export type RateLimitOptions = { max: number; windowMs: number };

const MAX_TRACKED_CLIENTS = 10_000;

/**
 * Fixed-window limit per client, kept in the memory of the process (a restart resets it; with several API
 * processes each counts on its own — acceptable for abuse protection, to be revisited with a shared store).
 * The address is behind a one-way hash salted with a per-process random secret and is never written to a log,
 * a file or the database: only counters live here, and only for one window.
 */
export function rateLimit(
  options: RateLimitOptions,
  onLimited: (c: Context) => Response,
  now: () => number = Date.now,
): MiddlewareHandler {
  const salt = randomBytes(16);
  const windows = new Map<string, { count: number; resetAt: number }>();

  return async (c, next) => {
    const t = now();
    if (windows.size >= MAX_TRACKED_CLIENTS) {
      for (const [key, w] of windows) if (w.resetAt <= t) windows.delete(key);
      if (windows.size >= MAX_TRACKED_CLIENTS) windows.clear(); // flood: forget everyone rather than grow
    }
    const key = createHash("sha256").update(salt).update(clientAddress(c.req.raw.headers)).digest("base64");
    let w = windows.get(key);
    if (!w || w.resetAt <= t) {
      w = { count: 0, resetAt: t + options.windowMs };
      windows.set(key, w);
    }
    w.count += 1;
    if (w.count > options.max) return onLimited(c);
    await next();
  };
}

/**
 * The reverse proxy appends the address it saw to `X-Forwarded-For`: the last entry is the one to trust,
 * earlier ones are client-supplied. Without a proxy (tests, local dev), all callers share one bucket.
 */
function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}
