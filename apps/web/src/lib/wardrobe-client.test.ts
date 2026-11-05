import { describe, expect, it, vi } from "vitest";
import { changeStage, createItem, fetchItemForProduct, undoMutation } from "./wardrobe-client";

const id = "00000000-0000-4000-8000-000000000001";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const deps = (response: Response) => ({ fetch: vi.fn(async () => response), ensure: vi.fn(async () => {}) });

const product = {
  id,
  shop: { name: "Shop", slug: "shop" },
  canonicalUrl: "https://a.fr/p",
  name: "Robe",
  brand: null,
  currency: "EUR",
  priceCents: null,
  compareAtCents: null,
  sizes: [],
  images: [],
  source: "captured",
  captureStatus: "ok",
  lastCapturedAt: null,
};
const item = {
  id,
  profileId: id,
  product,
  stage: "spotted",
  favorite: true,
  name: "Robe",
  brand: null,
  sizeLabel: null,
  sizeNote: null,
  notes: null,
  pricePaidCents: null,
  salePriceCents: null,
  saleChannel: null,
  nameOverride: null,
  brandOverride: null,
  categoryId: null,
  colorId: null,
  coverMediaId: null,
  coverUrl: null,
  photos: [],
  tags: [],
  wishlistIds: [],
  deletedAt: null,
  createdAt: "2026-11-05T10:00:00.000Z",
  updatedAt: "2026-11-05T10:00:00.000Z",
};

describe("createItem", () => {
  it("tells a creation (201) from an existing item (200)", async () => {
    const body = { itemIds: [id], undo: null, item };
    expect(await createItem({ productId: id, action: "favorite" }, deps(json(body, 201)))).toMatchObject({
      ok: true,
      created: true,
    });
    expect(await createItem({ productId: id, action: "favorite" }, deps(json(body, 200)))).toMatchObject({
      ok: true,
      created: false,
    });
  });

  it("refuses a malformed answer", async () => {
    expect(await createItem({ productId: id, action: "favorite" }, deps(json({ item: {} }, 201)))).toEqual({
      ok: false,
      error: "failed",
    });
  });
});

describe("errors", () => {
  it("maps a known API error code", async () => {
    const result = await changeStage(
      id,
      { stage: "owned", at: "2026-11-05T10:00:00.000Z" },
      deps(json({ error: "same_stage" }, 400)),
    );
    expect(result).toEqual({ ok: false, error: "same_stage" });
  });

  it("falls back to failed for an unknown code or a network error", async () => {
    expect(await undoMutation({ ops: [], removeEventIds: [] }, deps(json({ error: "weird" }, 500)))).toEqual({
      ok: false,
      error: "failed",
    });
    const broken = { fetch: vi.fn().mockRejectedValue(new Error("x")), ensure: vi.fn(async () => {}) };
    expect(await undoMutation({ ops: [], removeEventIds: [] }, broken)).toEqual({ ok: false, error: "failed" });
  });
});

describe("fetchItemForProduct", () => {
  it("asks for the product and returns the first item, or null", async () => {
    const d = deps(json({ items: [item], nextCursor: null }));
    expect(await fetchItemForProduct(id, d)).toMatchObject({ id });
    expect(d.fetch).toHaveBeenCalledWith(`/api/me/items?product=${id}`, expect.anything());
    expect(await fetchItemForProduct(id, deps(json({ items: [], nextCursor: null })))).toBeNull();
  });

  it("rejects a malformed page", async () => {
    await expect(fetchItemForProduct(id, deps(json({ items: [{}] })))).rejects.toThrow();
  });
});
