import { describe, expect, it } from "vitest";
import {
  audienceSchema,
  childDetailSchema,
  classifiedBySchema,
  DEFAULT_LOVE_LEVELS,
  ITEM_STAGE_ORDER,
  ITEMS_PAGE_SIZE,
  isSingleEmoji,
  itemBulkActionSchema,
  itemBulkSchema,
  itemCreateSchema,
  itemEventTypeSchema,
  itemListQuerySchema,
  itemMoveSchema,
  itemPageSchema,
  itemPatchSchema,
  itemSortSchema,
  itemStageInputSchema,
  itemStageSchema,
  itemViewSchema,
  loveLevelSchema,
  loveLevelsSchema,
  MAX_BULK_ITEMS,
  MAX_ITEM_PHOTOS,
  MAX_WHY,
  mutationResultSchema,
  profileColorSchema,
  profileInputSchema,
  seasonSchema,
  sharedWishlistViewSchema,
  shareResultSchema,
  tagInputSchema,
  undoPayloadSchema,
  wishlistInputSchema,
  wishlistViewSchema,
} from "./wardrobe";

const id = "0b6f3a52-3f0e-4b8c-9a47-0c1d2e3f4a5b";
const id2 = "1b6f3a52-3f0e-4b8c-9a47-0c1d2e3f4a5b";

describe("enums", () => {
  it("has the exact stages, audiences, seasons and others", () => {
    expect(itemStageSchema.options).toEqual(["spotted", "ordered", "owned", "for_sale", "sold", "returned"]);
    expect(audienceSchema.options).toEqual(["women", "men", "child", "mixed"]);
    expect(childDetailSchema.options).toEqual(["girl", "boy", "baby"]);
    expect(seasonSchema.options).toEqual(["summer", "winter", "mid", "all"]);
    expect(itemEventTypeSchema.options).toEqual(["stage", "profile"]);
    expect(classifiedBySchema.options).toEqual(["rule", "admin"]);
    expect(profileColorSchema.options).toEqual(["plum", "rose", "sage", "sand", "sky", "slate"]);
  });
  it("exports the limits", () => {
    expect([MAX_ITEM_PHOTOS, MAX_BULK_ITEMS, ITEMS_PAGE_SIZE]).toEqual([10, 200, 48]);
  });
});

describe("ITEM_STAGE_ORDER", () => {
  it("ranks stages, returned level with owned", () => {
    expect(ITEM_STAGE_ORDER.spotted).toBeLessThan(ITEM_STAGE_ORDER.ordered);
    expect(ITEM_STAGE_ORDER.ordered).toBeLessThan(ITEM_STAGE_ORDER.owned);
    expect(ITEM_STAGE_ORDER.owned).toBeLessThan(ITEM_STAGE_ORDER.for_sale);
    expect(ITEM_STAGE_ORDER.sold).toBeGreaterThan(ITEM_STAGE_ORDER.owned);
    expect(ITEM_STAGE_ORDER.for_sale).toBeLessThan(ITEM_STAGE_ORDER.sold);
    expect(ITEM_STAGE_ORDER.returned).toBe(ITEM_STAGE_ORDER.owned);
  });
});

describe("inputs", () => {
  it("profile: name 1-40, audience, optional child detail", () => {
    const ok = { name: "Moi", audience: "women", color: "plum" };
    expect(profileInputSchema.safeParse(ok).success).toBe(true);
    expect(profileInputSchema.safeParse({ ...ok, name: "" }).success).toBe(false);
    expect(profileInputSchema.safeParse({ ...ok, name: "x".repeat(41) }).success).toBe(false);
    expect(profileInputSchema.safeParse({ ...ok, audience: "child", childDetail: "baby" }).success).toBe(true);
    expect(profileInputSchema.safeParse({ ...ok, color: "red" }).success).toBe(false);
  });
  it("create refuses action list without wishlistId", () => {
    expect(itemCreateSchema.safeParse({ productId: id, action: "list" }).success).toBe(false);
    expect(itemCreateSchema.safeParse({ productId: id, action: "list", wishlistId: id2 }).success).toBe(true);
    expect(itemCreateSchema.safeParse({ productId: id, action: "wish" }).success).toBe(true);
    expect(itemCreateSchema.safeParse({ productId: id, action: "favorite" }).success).toBe(false);
    expect(
      itemCreateSchema.safeParse({ productId: id, action: "wish", loveLevel: 4, priority: true, why: "Mims" }).success,
    ).toBe(true);
    expect(itemCreateSchema.safeParse({ productId: id, action: "wish", loveLevel: 5 }).success).toBe(false);
    expect(itemCreateSchema.safeParse({ productId: id, action: "wish", why: "x".repeat(201) }).success).toBe(false);
    expect(itemCreateSchema.safeParse({ productId: id, profileId: id2, action: "ordered" }).success).toBe(true);
    expect(itemCreateSchema.safeParse({ productId: id, action: "sold" }).success).toBe(false);
  });
  it("patch enforces text limits", () => {
    expect(itemPatchSchema.safeParse({ loveLevel: 3, sizeLabel: "M", notes: "x".repeat(2000) }).success).toBe(true);
    expect(itemPatchSchema.safeParse({ loveLevel: null, priority: true, why: null, inOrderDraft: true }).success).toBe(
      true,
    );
    expect(itemPatchSchema.safeParse({ why: "x".repeat(MAX_WHY) }).success).toBe(true);
    expect(itemPatchSchema.safeParse({ why: "x".repeat(MAX_WHY + 1) }).success).toBe(false);
    expect(itemPatchSchema.safeParse({ loveLevel: 0 }).success).toBe(false);
    expect(itemPatchSchema.safeParse({ loveLevel: 2.5 }).success).toBe(false);
    // `favorite` is gone: an unknown key is stripped, so it changes nothing.
    expect(itemPatchSchema.parse({ favorite: true })).toEqual({});
    expect(itemPatchSchema.safeParse({ sizeLabel: "x".repeat(41) }).success).toBe(false);
    expect(itemPatchSchema.safeParse({ sizeNote: "x".repeat(201) }).success).toBe(false);
    expect(itemPatchSchema.safeParse({ notes: "x".repeat(2001) }).success).toBe(false);
    expect(itemPatchSchema.safeParse({ nameOverride: null, coverMediaId: null }).success).toBe(true);
  });
  it("stage input refuses an invalid date and unknown stage", () => {
    const ok = { stage: "sold", at: "2026-11-05T10:00:00.000Z", amountCents: 1500, channel: "Vinted" };
    expect(itemStageInputSchema.safeParse(ok).success).toBe(true);
    expect(itemStageInputSchema.safeParse({ ...ok, at: "demain" }).success).toBe(false);
    expect(itemStageInputSchema.safeParse({ ...ok, at: "2026-13-45T10:00:00Z" }).success).toBe(false);
    expect(itemStageInputSchema.safeParse({ ...ok, stage: "lost" }).success).toBe(false);
    expect(itemStageInputSchema.safeParse({ ...ok, amountCents: -1 }).success).toBe(false);
    expect(itemStageInputSchema.safeParse({ ...ok, amountCents: 100_000_000 }).success).toBe(true);
    expect(itemStageInputSchema.safeParse({ ...ok, amountCents: 100_000_001 }).success).toBe(false);
    expect(itemStageInputSchema.safeParse({ ...ok, channel: "x".repeat(61) }).success).toBe(false);
  });
  it("move needs a profile id", () => {
    expect(itemMoveSchema.safeParse({ profileId: id }).success).toBe(true);
    expect(itemMoveSchema.safeParse({}).success).toBe(false);
  });
  it("tag and wishlist limits", () => {
    expect(tagInputSchema.safeParse({ name: "x".repeat(40) }).success).toBe(true);
    expect(tagInputSchema.safeParse({ name: "x".repeat(41) }).success).toBe(false);
    expect(tagInputSchema.safeParse({ name: "" }).success).toBe(false);
    expect(wishlistInputSchema.safeParse({ name: "x".repeat(80) }).success).toBe(true);
    expect(wishlistInputSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });
});

describe("bulk", () => {
  const ids = (n: number) =>
    Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  it("accepts 200 ids and refuses 201 or none", () => {
    expect(itemBulkSchema.safeParse({ ids: ids(200), op: "delete" }).success).toBe(true);
    expect(itemBulkSchema.safeParse({ ids: ids(201), op: "delete" }).success).toBe(false);
    expect(itemBulkSchema.safeParse({ ids: [], op: "delete" }).success).toBe(false);
    expect(itemBulkSchema.safeParse({ ids: [id, id], op: "delete" }).success).toBe(false);
  });
  it("supports every operation with its payload", () => {
    const at = "2026-11-05T10:00:00.000Z";
    const cases = [
      { op: "stage", stage: "owned", at },
      { op: "addToList", wishlistId: id2 },
      { op: "removeFromList", wishlistId: id2 },
      { op: "move", profileId: id2 },
      { op: "addTag", tagId: id2 },
      { op: "removeTag", tagId: id2 },
      { op: "delete" },
      { op: "restore" },
      { op: "setFields", fields: { loveLevel: 4, priority: true, why: null, inOrderDraft: false } },
      { op: "setFields", fields: { notes: null, pricePaidCents: 1200, saleChannel: "Vinted" } },
    ];
    for (const c of cases) expect(itemBulkSchema.safeParse({ ids: [id], ...c }).success, c.op).toBe(true);
    expect(itemBulkSchema.safeParse({ ids: [id], op: "move" }).success).toBe(false);
    expect(itemBulkSchema.safeParse({ ids: [id], op: "explode" }).success).toBe(false);
    expect(itemBulkSchema.safeParse({ ids: [id], op: "setFavorite", favorite: true }).success).toBe(false);
  });
  it("setFields needs at least one valid field", () => {
    expect(itemBulkSchema.safeParse({ ids: [id], op: "setFields", fields: {} }).success).toBe(false);
    expect(itemBulkSchema.safeParse({ ids: [id], op: "setFields", fields: { pricePaidCents: -1 } }).success).toBe(
      false,
    );
    expect(itemBulkSchema.safeParse({ ids: [id], op: "setFields", fields: { saleChannel: "  " } }).success).toBe(false);
    expect(itemBulkSchema.safeParse({ ids: [id], op: "setFields", fields: { salePriceCents: null } }).success).toBe(
      true,
    );
  });
});

describe("love levels", () => {
  it("are 1 to 4, and the sort knows love", () => {
    expect([1, 2, 3, 4].every((n) => loveLevelSchema.safeParse(n).success)).toBe(true);
    expect([0, 5, 1.5].some((n) => loveLevelSchema.safeParse(n).success)).toBe(false);
    expect(MAX_WHY).toBe(200);
    expect(itemSortSchema.options).toContain("love");
  });
});

describe("list query", () => {
  it("parses query-string filters", () => {
    const q = itemListQuerySchema.parse({ stage: "owned", priority: "true", audience: "women", sort: "love" });
    expect(q.priority).toBe(true);
    expect(q.sort).toBe("love");
    expect(itemListQuerySchema.parse({ orderDraft: "false" }).orderDraft).toBe(false);
    expect(itemListQuerySchema.parse({ loveLevel: "4,3" }).loveLevel).toEqual([4, 3]);
    expect(itemListQuerySchema.parse({ loveLevel: "2" }).loveLevel).toEqual([2]);
    for (const bad of ["", "5", "0", "4,", "a", "2.5", "1,,2"]) {
      expect(itemListQuerySchema.safeParse({ loveLevel: bad }).success, bad).toBe(false);
    }
    expect("favorite" in itemListQuerySchema.parse({ favorite: "true" })).toBe(false);
    expect(itemListQuerySchema.safeParse({ stage: "nope" }).success).toBe(false);
    expect(itemListQuerySchema.safeParse({ cursor: "abc" }).success).toBe(true);
    expect(itemListQuerySchema.safeParse({}).success).toBe(true);
    expect(itemListQuerySchema.parse({ deleted: "true" }).deleted).toBe(true);
    expect(itemListQuerySchema.parse({ deleted: "false" }).deleted).toBe(false);
  });
});

const product = {
  id,
  shop: { id: "00000000-0000-4000-8000-0000000000aa", name: "Shop", slug: "shop" },
  canonicalUrl: "https://shop.example/p/1",
  name: "Robe",
  brand: null,
  currency: "EUR",
  priceCents: 4900,
  compareAtCents: null,
  sizes: [],
  images: [],
  source: "captured",
  description: null,
  captureStatus: "ok",
  lastCapturedAt: null,
  updatedAt: "2026-11-01T00:00:00.000Z",
  traits: { category: [], color: null, material: null, pattern: null, season: null, audience: null, childDetail: null },
  details: [],
};
const itemView = {
  id,
  profileId: id2,
  product,
  stage: "owned",
  loveLevel: null,
  priority: false,
  why: null,
  inOrderDraft: false,
  name: "Robe",
  brand: null,
  sizeLabel: null,
  sizeNote: null,
  notes: null,
  giftFrom: null,
  receivedAsGift: false,
  pricePaidCents: null,
  salePriceCents: null,
  saleChannel: null,
  nameOverride: null,
  brandOverride: null,
  categoryId: null,
  colorId: null,
  coverMediaId: null,
  coverUrl: null,
  photos: [{ id, url: "/m/1", width: 3, height: 4, source: "private" }],
  tags: [],
  wishlistIds: [],
  deletedAt: null,
  createdAt: "2026-11-05T10:00:00.000Z",
  updatedAt: "2026-11-05T10:00:00.000Z",
};

describe("views", () => {
  it("item view reuses the product view", () => {
    expect(itemViewSchema.safeParse(itemView).success).toBe(true);
    expect(itemViewSchema.safeParse({ ...itemView, product: { ...product, id: "x" } }).success).toBe(false);
  });
  it("page has items and nextCursor", () => {
    expect(itemPageSchema.safeParse({ items: [itemView], nextCursor: null }).success).toBe(true);
  });
  it("wishlist view", () => {
    const w = {
      id,
      name: "Été",
      itemIds: [id],
      shared: false,
      sharedAt: null,
      position: 0,
      allowOpinions: true,
      showOwnerName: true,
      showOwnerOpinions: true,
      showBudget: false,
      newOpinions: 0,
      allowGifts: false,
      giftOccasion: null,
      giftDate: null,
      giftReminderDue: false,
      groupOrder: null,
    };
    expect(wishlistViewSchema.safeParse(w).success).toBe(true);
    expect(wishlistViewSchema.safeParse({ ...w, shared: true, sharedAt: "2026-11-05T10:00:00.000Z" }).success).toBe(
      true,
    );
    expect(Object.keys(wishlistViewSchema.shape)).not.toContain("shareUrl");
  });
  it("share result is a /l/<token> url", () => {
    expect(shareResultSchema.safeParse({ url: "/l/abc_DEF-123" }).success).toBe(true);
    expect(shareResultSchema.safeParse({ url: "/listes/abc" }).success).toBe(false);
  });
  it("shared wishlist exposes none of the private keys", () => {
    const keys = Object.keys(sharedWishlistViewSchema.shape);
    for (const k of ["notes", "sizeLabel", "profile", "media"]) expect(keys).not.toContain(k);
    const itemKeys = Object.keys(sharedWishlistViewSchema.shape.items.element.shape);
    for (const k of ["notes", "sizeLabel", "profile", "media", "photos", "profileId"]) {
      expect(itemKeys).not.toContain(k);
    }
  });
  it("mutation result carries an undo payload or null", () => {
    expect(mutationResultSchema.safeParse({ itemIds: [id], undo: null }).success).toBe(true);
    const at = "2026-11-05T10:00:00.000Z";
    const undo = {
      ops: [
        { ids: [id], op: "stage", stage: "spotted", at },
        { ids: [id2], op: "stage", stage: "owned", at },
      ],
      removeEventIds: [id],
    };
    expect(mutationResultSchema.safeParse({ itemIds: [id, id2], undo }).success).toBe(true);
    expect(undoPayloadSchema.safeParse({ ...undo, ops: [] }).success).toBe(false);
    expect(undoPayloadSchema.safeParse({ ...undo, removeEventIds: ["x"] }).success).toBe(false);
    expect(undoPayloadSchema.safeParse({ ...undo, ops: [{ ids: [], op: "delete" }] }).success).toBe(false);
    const ids = (n: number, k: number) =>
      Array.from({ length: n }, (_, i) => `00000000-0000-4000-8${k}00-${String(i).padStart(12, "0")}`);
    const ops = (k: number) => [0, 1, 2].map((j) => ({ ids: ids(200, k + j), op: "delete" }));
    expect(undoPayloadSchema.safeParse({ ops: ops(0), removeEventIds: [] }).success).toBe(true);
    expect(
      undoPayloadSchema.safeParse({ ops: [...ops(0), { ids: [id], op: "restore" }], removeEventIds: [] }).success,
    ).toBe(false);
  });

  it("keeps the undo-only ops out of the bulk actions", () => {
    for (const op of ["unreceiveGift", "untakeGift"]) {
      expect(itemBulkSchema.safeParse({ ids: [id], op }).success).toBe(true);
      expect(itemBulkActionSchema.safeParse({ ids: [id], op }).success).toBe(false);
    }
    expect(itemBulkActionSchema.safeParse({ ids: [id], op: "delete" }).success).toBe(true);
  });
});

describe("isSingleEmoji", () => {
  it.each(["😀", "🤍", "👩🏽‍🦱", "🇫🇷", "1️⃣", "❤️"])("accepts %s", (value) => {
    expect(isSingleEmoji(value)).toBe(true);
  });
  it.each(["", "a", "1", "😀😀", "😀a", " 😀", "🇫🇷🇫🇷", "ab"])("refuses %j", (value) => {
    expect(isSingleEmoji(value)).toBe(false);
  });
  it("refuses more than 16 bytes", () => {
    expect(isSingleEmoji("👨‍👩‍👧‍👦")).toBe(false); // 25 bytes
  });
});

describe("loveLevelsSchema", () => {
  it("accepts the defaults", () => {
    expect(loveLevelsSchema.safeParse({ levels: DEFAULT_LOVE_LEVELS }).success).toBe(true);
  });
  it("refuses a duplicated level, 3 levels and a long label", () => {
    const [a, b, c, d] = DEFAULT_LOVE_LEVELS;
    expect(loveLevelsSchema.safeParse({ levels: [a, b, c, { ...c, level: 3 }] }).success).toBe(false);
    expect(loveLevelsSchema.safeParse({ levels: [a, b, c] }).success).toBe(false);
    expect(loveLevelsSchema.safeParse({ levels: [a, b, c, { ...d, label: "x".repeat(21) }] }).success).toBe(false);
  });
  it("trims labels", () => {
    const [a, b, c, d] = DEFAULT_LOVE_LEVELS;
    const out = loveLevelsSchema.parse({ levels: [{ ...a, label: "  Bof  " }, b, c, d] });
    expect(out.levels[0]?.label).toBe("Bof");
  });
});
