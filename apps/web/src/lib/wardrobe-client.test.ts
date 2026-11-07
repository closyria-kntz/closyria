import { describe, expect, it, vi } from "vitest";
import {
  changeStage,
  createItem,
  deleteProfile,
  fetchFacets,
  fetchItemForProduct,
  fetchItemsPage,
  fetchLoveLevels,
  fetchPhotoImport,
  fetchRecents,
  fetchReference,
  forgetRecent,
  importPhoto,
  purgeItem,
  reorderWishlists,
  saveLoveLevels,
  shareWishlist,
  undoMutation,
  whyOrNull,
  wishCreate,
} from "./wardrobe-client";

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
  description: null,
  captureStatus: "ok",
  lastCapturedAt: null,
  traits: { category: [], color: null, material: null, pattern: null, season: null, audience: null, childDetail: null },
  details: [],
};
const item = {
  id,
  profileId: id,
  product,
  stage: "spotted",
  loveLevel: 2,
  priority: false,
  why: null,
  inOrderDraft: false,
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
    expect(await createItem({ productId: id, action: "wish" }, deps(json(body, 201)))).toMatchObject({
      ok: true,
      created: true,
    });
    expect(await createItem({ productId: id, action: "wish" }, deps(json(body, 200)))).toMatchObject({
      ok: true,
      created: false,
    });
  });

  it("refuses a malformed answer", async () => {
    expect(await createItem({ productId: id, action: "wish" }, deps(json({ item: {} }, 201)))).toEqual({
      ok: false,
      error: "failed",
    });
  });
});

describe("wishCreate and whyOrNull", () => {
  it("sends her level, priority and trimmed opinion with action wish", () => {
    expect(wishCreate({ productId: id, profileId: id }, { loveLevel: 3, priority: true, why: "  Trop mims " })).toEqual(
      {
        productId: id,
        profileId: id,
        action: "wish",
        loveLevel: 3,
        priority: true,
        why: "Trop mims",
      },
    );
  });

  it("leaves a blank opinion out", () => {
    expect(wishCreate({ productId: id }, { loveLevel: 2, priority: false, why: "   " })).toEqual({
      productId: id,
      action: "wish",
      loveLevel: 2,
      priority: false,
    });
  });

  it("turns a blank opinion into null for a patch", () => {
    expect(whyOrNull("  ")).toBeNull();
    expect(whyOrNull(" Douce ")).toBe("Douce");
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

describe("view reads", () => {
  it("asks a page with the filters and the cursor", async () => {
    const d = deps(json({ items: [], nextCursor: "abc" }));
    const page = await fetchItemsPage({ stage: "owned", priority: "true" }, "cur", d);
    expect(page.nextCursor).toBe("abc");
    expect(d.fetch).toHaveBeenCalledWith("/api/me/items?stage=owned&priority=true&cursor=cur", expect.anything());
  });

  it("shows nothing without a session, and throws on a server error", async () => {
    expect(await fetchItemsPage({}, null, deps(json({}, 401)))).toEqual({ items: [], nextCursor: null });
    await expect(fetchItemsPage({}, null, deps(json({}, 500)))).rejects.toThrow();
    expect(await fetchFacets(deps(json({}, 401)))).toEqual({ shops: [] });
  });

  it("validates the reference lists", async () => {
    const ok = { categories: [{ id, parentId: null, name: "Robes", position: 0 }], colors: [] };
    expect((await fetchReference(deps(json(ok)))).categories).toHaveLength(1);
    await expect(fetchReference(deps(json({ categories: 3 })))).rejects.toThrow();
  });
});

describe("lists, sharing, profiles and trash", () => {
  const listId = "00000000-0000-4000-8000-000000000002";

  it("shareWishlist returns the path the API gave, once", async () => {
    const d = deps(json({ url: "/l/abcDEF_-123" }));
    const result = await shareWishlist(listId, d);
    expect(result).toMatchObject({ ok: true, url: "/l/abcDEF_-123" });
    expect(d.fetch).toHaveBeenCalledWith(`/api/me/wishlists/${listId}/share`, { method: "POST" });
  });

  it("shareWishlist refuses an answer that is not a share path", async () => {
    expect(await shareWishlist(listId, deps(json({ url: "https://evil.test/x" })))).toEqual({
      ok: false,
      error: "failed",
    });
  });

  it("reorderWishlists posts the ids in their new order", async () => {
    const d = deps(json({ wishlists: [] }));
    expect(await reorderWishlists([listId, id], d)).toMatchObject({ ok: true });
    expect(d.fetch).toHaveBeenCalledWith(
      "/api/me/wishlists/order",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ ids: [listId, id] }) }),
    );
  });

  it("deleteProfile keeps the API's profile_not_empty code", async () => {
    expect(await deleteProfile(id, deps(json({ error: "profile_not_empty" }, 409)))).toEqual({
      ok: false,
      error: "profile_not_empty",
    });
  });

  it("deleteProfile and purgeItem succeed on 204 with no body", async () => {
    expect(await deleteProfile(id, deps(new Response(null, { status: 204 })))).toEqual({ ok: true });
    expect(await purgeItem(id, deps(new Response(null, { status: 204 })))).toEqual({ ok: true });
  });

  it("purgeItem keeps item_not_deleted", async () => {
    expect(await purgeItem(id, deps(json({ error: "item_not_deleted" }, 409)))).toEqual({
      ok: false,
      error: "item_not_deleted",
    });
  });
});

describe("recents", () => {
  const recent = { product, visitedAt: "2026-11-06T10:00:00.000Z" };

  it("returns the list, without opening a session", async () => {
    const d = deps(json({ recents: [recent] }));
    const list = await fetchRecents(d);
    expect(list?.recents).toHaveLength(1);
    expect(d.ensure).not.toHaveBeenCalled();
  });

  it("returns null without a session (401)", async () => {
    expect(await fetchRecents(deps(json({ error: "unauthorized" }, 401)))).toBeNull();
  });

  it("throws on an invalid answer", async () => {
    await expect(fetchRecents(deps(json({ recents: [{ nope: 1 }] })))).rejects.toThrow();
  });

  it("throws on a server error", async () => {
    await expect(fetchRecents(deps(json({}, 500)))).rejects.toThrow();
  });

  it("forgets a recent with a DELETE", async () => {
    const d = deps(new Response(null, { status: 204 }));
    expect(await forgetRecent(id, d)).toEqual({ ok: true });
    expect(d.fetch).toHaveBeenCalledWith(`/api/me/recents/${id}`, { method: "DELETE" });
  });
});

describe("photo import", () => {
  it("starts an import and keeps its id", async () => {
    const d = deps(json({ importId: id }, 202));
    expect(await importPhoto(id, "https://x.test/a.jpg", d)).toMatchObject({ ok: true, importId: id });
    expect(d.fetch).toHaveBeenCalledWith(
      `/api/me/items/${id}/media/imports`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ url: "https://x.test/a.jpg" }) }),
    );
  });
  it("keeps the API error code", async () => {
    expect(await importPhoto(id, "https://x.test/a.jpg", deps(json({ error: "too_many_photos" }, 409)))).toEqual({
      ok: false,
      error: "too_many_photos",
    });
    expect(await importPhoto(id, "https://x.test/a.jpg", deps(json({ error: "rate_limited" }, 429)))).toEqual({
      ok: false,
      error: "rate_limited",
    });
  });
  it("reads the state of an import", async () => {
    expect(await fetchPhotoImport(id, id, deps(json({ status: "queued" })))).toEqual({ status: "queued" });
    expect(await fetchPhotoImport(id, id, deps(json({ status: "failed", error: "blocked" })))).toEqual({
      status: "failed",
      error: "blocked",
    });
  });
  it("throws on an error status or a malformed answer", async () => {
    await expect(fetchPhotoImport(id, id, deps(json({}, 500)))).rejects.toThrow();
    await expect(fetchPhotoImport(id, id, deps(json({ status: "weird" })))).rejects.toThrow();
  });
});

describe("love levels", () => {
  const levels = [
    { level: 1, emoji: "😕", label: "Bof" },
    { level: 2, emoji: "🤍", label: "J’aime" },
    { level: 3, emoji: "💖", label: "Coup de cœur" },
    { level: 4, emoji: "🔥", label: "En feu" },
  ];

  it("reads her levels, the starting ones without a session", async () => {
    const d = deps(json({ levels }));
    expect(await fetchLoveLevels(d)).toEqual(levels);
    expect(d.fetch).toHaveBeenCalledWith("/api/me/love-levels", expect.anything());
    expect((await fetchLoveLevels(deps(json({}, 401)))).map((l) => l.label)).toEqual([
      "Bof",
      "J’aime",
      "Mims",
      "En feu",
    ]);
    await expect(fetchLoveLevels(deps(json({}, 500)))).rejects.toThrow();
  });

  it("saves the four levels with PUT", async () => {
    const d = deps(json({ levels }));
    expect(await saveLoveLevels(levels, d)).toMatchObject({ ok: true, levels });
    expect(d.fetch).toHaveBeenCalledWith("/api/me/love-levels", expect.objectContaining({ method: "PUT" }));
    expect(await saveLoveLevels(levels, deps(json({ error: "invalid_request" }, 400)))).toEqual({
      ok: false,
      error: "invalid_request",
    });
  });
});
