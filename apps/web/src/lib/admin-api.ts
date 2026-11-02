import { type AdminSession, adminSessionSchema } from "@closyria/shared";
import { z } from "zod";

/** How the web server reaches the API: directly on the machine, never through the public URL. */
export type InternalApi = {
  fetch: typeof globalThis.fetch;
  baseUrl: string;
  /** The visitor's Cookie header, forwarded as is. */
  cookie: string;
  /**
   * The X-Forwarded-For header this page request came with. Caddy overwrites it with the visitor's address;
   * passing it on lets the API's per-address limits (Better Auth's included) count this visitor, rather than
   * one shared bucket for every server-side call.
   */
  forwardedFor?: string | undefined;
};

const envSchema = z.object({ INTERNAL_API_URL: z.url().default("http://127.0.0.1:3001") });

/** `INTERNAL_API_URL` (set in the systemd units), validated; the local API by default. */
export function internalApiUrl(env: Record<string, string | undefined>): string {
  return envSchema.parse(env).INTERNAL_API_URL.replace(/\/$/, "");
}

/** The API runs on the same machine: an answer slower than this means it is down or stuck. */
const INTERNAL_TIMEOUT_MS = 5000;

/** The last X-Forwarded-For entry: the address Caddy saw. Earlier entries are whatever the client sent. */
function visitorAddress(forwardedFor: string | undefined): string | undefined {
  return forwardedFor
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .at(-1);
}

const request = (api: InternalApi, path: string) => {
  const visitor = visitorAddress(api.forwardedFor);
  return api.fetch(`${api.baseUrl}${path}`, {
    headers: { cookie: api.cookie, ...(visitor ? { "x-forwarded-for": visitor } : {}) },
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
