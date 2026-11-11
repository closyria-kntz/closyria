import { describe, expect, it, vi } from "vitest";
import {
  adminRequest,
  catalogErrorKey,
  productErrorKey,
  readCaptureResult,
  referenceErrorKey,
  shopPatchErrorKey,
} from "./admin-catalog";

describe("catalogErrorKey", () => {
  it("maps the API refusals to a message key", () => {
    expect(catalogErrorKey(409, { error: "slug_taken" })).toBe("slugTaken");
    expect(catalogErrorKey(409, { error: "domain_taken" })).toBe("domainTaken");
    expect(catalogErrorKey(409, { error: "capture_active" })).toBe("captureActive");
    expect(catalogErrorKey(409, { error: "not_published" })).toBe("notPublished");
    expect(catalogErrorKey(400, { error: "invalid_merge" })).toBe("invalidMerge");
    expect(catalogErrorKey(400, { error: "invalid_url" })).toBe("invalidUrl");
  });

  it("falls back to a generic message for anything else", () => {
    expect(catalogErrorKey(500, null)).toBe("generic");
    expect(catalogErrorKey(400, { error: "invalid_request" })).toBe("generic");
    expect(catalogErrorKey(409, "nope")).toBe("generic");
  });
});

describe("readCaptureResult", () => {
  const product = {
    name: "Robe",
    currency: "EUR",
    priceCents: 2999,
    images: ["https://cdn.example.com/a.jpg"],
    sizes: [{ label: "M", available: true }],
    siteName: "Mango",
    platform: "other",
  };

  it("keeps a valid extracted product", () => {
    expect(readCaptureResult(product)?.name).toBe("Robe");
  });

  it("returns null for a missing or malformed result", () => {
    expect(readCaptureResult(null)).toBeNull();
    expect(readCaptureResult({ name: 3 })).toBeNull();
  });
});

describe("adminRequest", () => {
  it("sends JSON to the same origin and returns the status and body", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Response.json({ error: "slug_taken" }, { status: 409 });
    };
    const result = await adminRequest("PATCH", "/api/admin/shops/1", { slug: "a" }, fetchImpl as typeof fetch);
    expect(result).toEqual({ ok: false, status: 409, body: { error: "slug_taken" } });
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(calls[0]?.init?.body).toBe('{"slug":"a"}');
    expect(new Headers(calls[0]?.init?.headers).get("content-type")).toBe("application/json");
  });

  it("turns a network failure into status 0", async () => {
    const failing = async () => {
      throw new TypeError("offline");
    };
    expect(await adminRequest("POST", "/x", undefined, failing as unknown as typeof fetch)).toEqual({
      ok: false,
      status: 0,
      body: null,
    });
  });
});

describe("shopPatchErrorKey", () => {
  it("blames the slug or domains for a 400, and keeps the other mappings", () => {
    expect(shopPatchErrorKey(400, { error: "invalid_request" })).toBe("invalidFields");
    expect(shopPatchErrorKey(409, { error: "slug_taken" })).toBe("slugTaken");
    expect(shopPatchErrorKey(409, { error: "domain_taken" })).toBe("domainTaken");
    expect(shopPatchErrorKey(500, null)).toBe("generic");
  });

  it("maps the reference refusals", () => {
    expect(referenceErrorKey(400, { error: "cycle" })).toBe("cycle");
    expect(referenceErrorKey(409, { error: "has_children" })).toBe("hasChildren");
    expect(referenceErrorKey(409, { error: "slug_taken" })).toBe("slugTaken");
    expect(referenceErrorKey(400, { error: "invalid_request" })).toBe("invalidEntry");
    expect(referenceErrorKey(500, null)).toBe("generic");
  });

  it("maps the product refusals", () => {
    expect(productErrorKey(400, { error: "invalid_request" })).toBe("invalidProduct");
    expect(productErrorKey(409, { error: "capture_active" })).toBe("captureActive");
    expect(productErrorKey(409, { error: "kept" })).toBe("kept");
  });

  it("sends a DELETE without a body", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    const result = await adminRequest("DELETE", "/api/admin/reference/colors/1", undefined, fetchImpl as typeof fetch);
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith("/api/admin/reference/colors/1", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
    });
  });
});
