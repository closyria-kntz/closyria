import { type ExtractedProduct, extractedProductSchema } from "@closyria/shared";

export type CatalogErrorKey =
  | "slugTaken"
  | "domainTaken"
  | "captureActive"
  | "invalidMerge"
  | "invalidUrl"
  | "invalidFields"
  | "invalidReference"
  | "cycle"
  | "hasChildren"
  | "generic";

/** The message (under `Admin.shops.errors`) for a refusal of the admin catalog API. */
export function catalogErrorKey(status: number, body: unknown): CatalogErrorKey {
  const error = typeof body === "object" && body !== null && "error" in body ? body.error : undefined;
  if (status === 409 && error === "slug_taken") return "slugTaken";
  if (status === 409 && error === "domain_taken") return "domainTaken";
  if (status === 409 && error === "capture_active") return "captureActive";
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
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  fetchImpl: typeof globalThis.fetch = fetch,
): Promise<AdminRequestResult> {
  try {
    const res = await fetchImpl(path, {
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
  return status === 400 && key === "generic" ? "invalidFields" : key;
}

/** Like `catalogErrorKey`, for a product PATCH or re-capture: its 400 is a field or a list entry that no longer exists. */
export function productErrorKey(status: number, body: unknown): CatalogErrorKey {
  const key = catalogErrorKey(status, body);
  return status === 400 && key === "generic" ? "invalidReference" : key;
}
