import { type ExtractedProduct, extractedProductSchema } from "@closyria/shared";

export type CatalogErrorKey =
  | "slugTaken"
  | "domainTaken"
  | "captureActive"
  | "kept"
  | "invalidMerge"
  | "invalidUrl"
  | "invalidFields"
  | "invalidEntry"
  | "invalidProduct"
  | "cycle"
  | "hasChildren"
  | "notPublished"
  | "majorBrand"
  | "notShopify"
  | "shopMerged"
  | "shopRefused"
  | "generic";

/** The message (under `Admin.shops.errors`) for a refusal of the admin catalog API. */
export function catalogErrorKey(status: number, body: unknown): CatalogErrorKey {
  const error = typeof body === "object" && body !== null && "error" in body ? body.error : undefined;
  if (status === 409 && error === "slug_taken") return "slugTaken";
  if (status === 409 && error === "domain_taken") return "domainTaken";
  if (status === 409 && error === "capture_active") return "captureActive";
  if (status === 409 && error === "kept") return "kept";
  if (status === 409 && error === "not_published") return "notPublished";
  if (status === 409 && error === "major_brand") return "majorBrand";
  if (status === 409 && error === "not_shopify") return "notShopify";
  if (status === 409 && error === "merged") return "shopMerged";
  if (status === 409 && error === "refused") return "shopRefused";
  if (status === 400 && error === "invalid_merge") return "invalidMerge";
  if (status === 400 && error === "invalid_url") return "invalidUrl";
  return "generic";
}

/** The product a finished capture extracted; null when the result is missing or does not match. */
export function readCaptureResult(result: unknown): ExtractedProduct | null {
  const parsed = extractedProductSchema.safeParse(result);
  return parsed.success ? parsed.data : null;
}

export type AdminRequestResult = { ok: boolean; status: number; body: unknown };

/** A same-origin call to the admin API from the browser (the cookie goes along). Never throws: status 0 is a network failure. */
export async function adminRequest(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  fetchImpl: typeof globalThis.fetch = fetch,
  init: Pick<RequestInit, "cache" | "signal"> = {},
): Promise<AdminRequestResult> {
  try {
    const res = await fetchImpl(path, {
      ...init,
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

/** Like `catalogErrorKey`, for a shop PATCH: its 400 is a bad slug or domain (the test URL is checked before sending). */
export function shopPatchErrorKey(status: number, body: unknown): CatalogErrorKey {
  const key = catalogErrorKey(status, body);
  return status === 400 && key === "generic" ? "invalidFields" : key;
}

/** Like `catalogErrorKey`, for the reference lists: cycle, sub-categories left, duplicate slug, bad fields. */
export function referenceErrorKey(status: number, body: unknown): CatalogErrorKey {
  const error = typeof body === "object" && body !== null && "error" in body ? body.error : undefined;
  if (status === 400 && error === "cycle") return "cycle";
  if (status === 409 && error === "has_children") return "hasChildren";
  const key = catalogErrorKey(status, body);
  return status === 400 && key === "generic" ? "invalidEntry" : key;
}

/** Like `catalogErrorKey`, for a product PATCH, re-capture or delete: its 400 is a bad field or a list entry that no longer exists (the API does not tell them apart). */
export function productErrorKey(status: number, body: unknown): CatalogErrorKey {
  const key = catalogErrorKey(status, body);
  return status === 400 && key === "generic" ? "invalidProduct" : key;
}

const IMPORT_ERROR_KEYS = {
  blocked: "blocked",
  robots_disallowed: "robots",
  suspicious_shrink: "shrink",
  no_address: "noAddress",
  timeout: "timeout",
  http_error: "httpError",
  invalid_data: "invalidData",
  too_many_pages: "tooManyPages",
  interrupted: "interrupted",
  woocommerce_api_unavailable: "wooApiUnavailable",
  unsupported_platform: "unsupportedPlatform",
} as const;
export type ImportErrorKey = (typeof IMPORT_ERROR_KEYS)[keyof typeof IMPORT_ERROR_KEYS];

/**
 * The message (under `Admin.shops.catalogue.importErrors`) for a shop's `last_import_error`, written by the worker as
 * a code optionally followed by ` (HTTP <status>)`; an unknown code is given back raw.
 */
export function importErrorMessage(code: string): { key: ImportErrorKey; status: number | null } | { raw: string } {
  const match = /^([a-z_]+)(?: \(HTTP (\d{3})\))?$/.exec(code);
  const name = match?.[1];
  if (!name || !Object.hasOwn(IMPORT_ERROR_KEYS, name)) return { raw: code };
  return {
    key: IMPORT_ERROR_KEYS[name as keyof typeof IMPORT_ERROR_KEYS],
    status: match[2] ? Number(match[2]) : null,
  };
}

/** The French clock of an instant, as « Terminé à {hours} h {minutes} » writes it (Paris time, 24 h, two digits). */
export function parisClock(iso: string): { hours: string; minutes: string } {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Europe/Paris",
  }).formatToParts(new Date(iso));
  const part = (type: "hour" | "minute") => parts.find((p) => p.type === type)?.value ?? "00";
  return { hours: part("hour"), minutes: part("minute") };
}
