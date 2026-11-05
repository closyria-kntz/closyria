import { createAuthClient, ensureSession } from "@closyria/auth/client";
import {
  type CaptureView,
  captureAcceptedSchema,
  captureViewSchema,
  type ManualEntry,
  type ProductView,
  productViewSchema,
} from "@closyria/shared";

/** Browser calls to the API (same origin, under /api); every answer is validated with the shared schemas. */
export type ClientDeps = { fetch: typeof fetch; ensure: () => Promise<void> };

const defaultDeps: ClientDeps = {
  fetch: (...args) => fetch(...args),
  ensure: () => ensureSession(createAuthClient(window.location.origin)),
};

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export type CreateCaptureResult =
  | { ok: true; productId: string; captureId: string }
  | { ok: false; error: "invalid_url" | "rate_limited" | "failed" };

export async function createCapture(url: string, deps: ClientDeps = defaultDeps): Promise<CreateCaptureResult> {
  try {
    await deps.ensure();
    const response = await deps.fetch("/api/captures", jsonInit("POST", { url }));
    if (response.status === 202) {
      const parsed = captureAcceptedSchema.safeParse(await response.json());
      if (parsed.success) return { ok: true, productId: parsed.data.productId, captureId: parsed.data.captureId };
    }
    if (response.status === 400 || response.status === 429) {
      const body = (await response.json()) as { error?: string };
      if (body.error === "invalid_url") return { ok: false, error: "invalid_url" };
      if (body.error === "rate_limited") return { ok: false, error: "rate_limited" };
    }
  } catch {
    // Falls through to the generic error.
  }
  return { ok: false, error: "failed" };
}

export async function fetchCaptureView(
  id: string,
  deps: ClientDeps = defaultDeps,
  signal?: AbortSignal,
): Promise<CaptureView> {
  const response = await deps.fetch(`/api/captures/${id}`, { cache: "no-store", signal: signal ?? null });
  if (!response.ok) throw new Error(`capture ${response.status}`);
  return captureViewSchema.parse(await response.json());
}

export async function fetchProduct(
  id: string,
  deps: ClientDeps = defaultDeps,
  signal?: AbortSignal,
): Promise<ProductView | "not_found"> {
  const response = await deps.fetch(`/api/products/${id}`, { cache: "no-store", signal: signal ?? null });
  if (response.status === 404) return "not_found";
  if (!response.ok) throw new Error(`product ${response.status}`);
  return productViewSchema.parse(await response.json());
}

export type SaveManualResult =
  | { ok: true; product: ProductView }
  | { ok: false; error: "rate_limited" | "not_found" | "failed" };

export async function saveManual(
  id: string,
  entry: ManualEntry,
  deps: ClientDeps = defaultDeps,
): Promise<SaveManualResult> {
  try {
    await deps.ensure();
    const response = await deps.fetch(`/api/products/${id}/manual`, jsonInit("PUT", entry));
    if (response.status === 429) return { ok: false, error: "rate_limited" };
    if (response.status === 404) return { ok: false, error: "not_found" };
    if (response.ok) {
      const parsed = productViewSchema.safeParse(await response.json());
      if (parsed.success) return { ok: true, product: parsed.data };
    }
  } catch {
    // Falls through to the generic error.
  }
  return { ok: false, error: "failed" };
}
