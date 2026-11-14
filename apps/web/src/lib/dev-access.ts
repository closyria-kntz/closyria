import { DEV_ACCESS_PAGE } from "@closyria/shared";
import { safeNext } from "./sign-in";

/**
 * Where to go once the device has access: the `suite` of /acces-dev?suite=…, a path of this site only (no open
 * redirect), else the home page. Caddy writes the original path and query after `suite=` as they were, unencoded
 * (deploy/caddy/dev.closyria.com.caddy), so everything after `?suite=` is the path, `&…` included; a hand-written
 * link may encode it instead.
 */
export function devAccessReturnPath(search: string): string {
  const prefix = "?suite=";
  if (!search.startsWith(prefix)) return "/";
  const raw = search.slice(prefix.length);
  let candidate = raw;
  if (!raw.startsWith("/")) {
    try {
      candidate = decodeURIComponent(raw);
    } catch {
      return "/";
    }
  }
  const path = safeNext(candidate);
  const pathname = new URL(path, "https://closyria.invalid").pathname.replace(/\/+$/, "");
  return pathname === DEV_ACCESS_PAGE ? "/" : path;
}

export type DevAccessErrorKey = "wrongPassword" | "tooManyTries" | "failed";

/** Message key for a refused try (`DevAccess.errors.*`); 0 is a network failure. */
export function devAccessErrorKey(status: number): DevAccessErrorKey {
  if (status === 401) return "wrongPassword";
  if (status === 429) return "tooManyTries";
  return "failed";
}
