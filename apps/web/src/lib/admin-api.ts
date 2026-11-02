import { type AdminSession, adminSessionSchema, lastForwardedAddress } from "@closyria/shared";
import { z } from "zod";

/** How the web server reaches the API: directly on the machine, never through the public URL. */
export type InternalApi = {
  fetch: typeof globalThis.fetch;
  baseUrl: string;
  /** The visitor's Cookie header, forwarded as is. */
  cookie: string;
  /**
   * The visitor's address (last X-Forwarded-For entry, written by Caddy), passed on so that the API's
   * per-address limits, Better Auth's included, count this visitor rather than one bucket shared by every
   * server-side call. A request that reached Next directly (local checks) carries the socket address, which
   * Next fills in: 127.0.0.1 is a trusted proxy for Better Auth, so those calls stay in its shared bucket.
   */
  visitorAddress?: string | undefined;
};

const envSchema = z.object({ INTERNAL_API_URL: z.url().default("http://127.0.0.1:3001") });

/** `INTERNAL_API_URL` (set in the systemd units), validated; the local API by default. */
export function internalApiUrl(env: Record<string, string | undefined>): string {
  return envSchema.parse(env).INTERNAL_API_URL.replace(/\/$/, "");
}

/** The internal API for one page request: its cookies and its visitor's address, read once. */
export function internalApiFor(
  incoming: Headers,
  env: Record<string, string | undefined>,
  fetchImpl: typeof globalThis.fetch = fetch,
): InternalApi {
  return {
    fetch: fetchImpl,
    baseUrl: internalApiUrl(env),
    cookie: incoming.get("cookie") ?? "",
    visitorAddress: lastForwardedAddress(incoming.get("x-forwarded-for")),
  };
}

/** The API runs on the same machine: an answer slower than this means it is down or stuck. */
const INTERNAL_TIMEOUT_MS = 5000;

const request = (api: InternalApi, path: string) => {
  return api.fetch(`${api.baseUrl}${path}`, {
    headers: { cookie: api.cookie, ...(api.visitorAddress ? { "x-forwarded-for": api.visitorAddress } : {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(INTERNAL_TIMEOUT_MS),
  });
};

/** The caller's session as Better Auth sees it, reduced to role and sign-in method; null without one. */
export async function fetchAdminSession(api: InternalApi): Promise<AdminSession> {
  const res = await request(api, "/api/auth/get-session");
  if (!res.ok) throw new Error(`get-session answered ${res.status}`);
  return adminSessionSchema.parse(await res.json());
}

export type AdminResult<T> = { ok: true; data: T } | { ok: false; status: number };

/** An admin API read with the caller's cookies. A refusal (4xx) is a result; a server error throws. */
export async function fetchAdminJson<T>(api: InternalApi, path: string, schema: z.ZodType<T>): Promise<AdminResult<T>> {
  const res = await request(api, path);
  if (res.status >= 400 && res.status < 500) return { ok: false, status: res.status };
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return { ok: true, data: schema.parse(await res.json()) };
}
