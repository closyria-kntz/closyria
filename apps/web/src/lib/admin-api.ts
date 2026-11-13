import {
  type AdminSession,
  adminCaptureFailuresSchema,
  adminProductDetailSchema,
  adminProductListSchema,
  adminSessionSchema,
  adminShopDetailSchema,
  adminShopListSchema,
  lastForwardedAddress,
  type ReferenceKind,
  referenceListSchema,
} from "@closyria/shared";
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

/** The session check got an answer that is not a success. Carries the HTTP status only (nothing personal). */
export class SessionCheckError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`get-session answered ${status}`);
    this.name = "SessionCheckError";
    this.status = status;
  }
}

/** The caller's session as Better Auth sees it, reduced to role and sign-in method; null without one. */
export async function fetchAdminSession(api: InternalApi): Promise<AdminSession> {
  const res = await request(api, "/api/auth/get-session");
  if (!res.ok) throw new SessionCheckError(res.status);
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A query string from the filters that are set; an empty filter means "all". */
function withQuery(path: string, filters: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

export type ShopFilters = { status?: string | undefined; mode?: string | undefined; health?: string | undefined };
export type FailureFilters = { shopId?: string | undefined; errorCode?: string | undefined };

export const adminShopsPath = (filters: ShopFilters) => withQuery("/api/admin/shops", filters);
export const adminFailuresPath = (filters: FailureFilters) => withQuery("/api/admin/captures/failures", filters);

export const fetchAdminShops = (api: InternalApi, filters: ShopFilters) =>
  fetchAdminJson(api, adminShopsPath(filters), adminShopListSchema);

/** One shop; an id that is not a UUID is an unknown shop (it never reaches the API path). */
export async function fetchAdminShop(api: InternalApi, id: string) {
  if (!UUID.test(id)) return { ok: false, status: 404 } as const;
  return fetchAdminJson(api, `/api/admin/shops/${id}`, adminShopDetailSchema);
}

export const fetchAdminFailures = (api: InternalApi, filters: FailureFilters) =>
  fetchAdminJson(api, adminFailuresPath(filters), adminCaptureFailuresSchema);

export type ProductFilters = {
  q?: string | undefined;
  shopId?: string | undefined;
  captureStatus?: string | undefined;
  classified?: string | undefined;
  catalogue?: string | undefined;
  cursor?: string | undefined;
};

export const adminProductsPath = (filters: ProductFilters) => withQuery("/api/admin/products", filters);

export const fetchAdminProducts = (api: InternalApi, filters: ProductFilters) =>
  fetchAdminJson(api, adminProductsPath(filters), adminProductListSchema);

/** One product sheet; an id that is not a UUID is an unknown sheet. */
export async function fetchAdminProduct(api: InternalApi, id: string) {
  if (!UUID.test(id)) return { ok: false, status: 404 } as const;
  return fetchAdminJson(api, `/api/admin/products/${id}`, adminProductDetailSchema);
}

export const fetchAdminReference = (api: InternalApi, kind: ReferenceKind) =>
  fetchAdminJson(api, `/api/admin/reference/${kind}`, referenceListSchema);
