import { randomUUID } from "node:crypto";
import { and, asc, eq, schema } from "@closyria/db";
import type { ItemView, MutationResult } from "@closyria/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let counter = 0;
const UNKNOWN_ID = "7b1f6a52-3a0b-4a4c-9f0e-5b1c2d3e4f50";

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness();
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

type ItemResult = MutationResult & { item: ItemView };
type ProfileJson = { id: string; name: string };

function call(method: string, path: string, cookie: string | undefined, body?: unknown) {
  return t.app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

async function newShop() {
  const n = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `Boutique I${n}`, slug: `me-items-shop-${n}` })
    .returning();
  if (!shop) throw new Error("no shop");
  return shop;
}

async function newProduct(overrides: Partial<typeof schema.products.$inferInsert> = {}) {
  const shop = await newShop();
  const n = ++counter;
  const [product] = await t.db
    .insert(schema.products)
    .values({ shopId: shop.id, canonicalUrl: `https://me-items-${n}.test/p`, name: `Robe ${n}`, ...overrides })
    .returning();
  if (!product) throw new Error("no product");
  return product;
}

async function keep(cookie: string, body: Record<string, unknown>) {
  const res = await call("POST", "/api/me/items", cookie, body);
  expect([200, 201]).toContain(res.status);
  return (await res.json()) as ItemResult;
}

async function newProfile(cookie: string, name = "Léa") {
  const res = await call("POST", "/api/me/profiles", cookie, { name, audience: "women", color: "rose" });
  expect(res.status).toBe(201);
  return (await res.json()) as ProfileJson;
}

async function defaultProfile(cookie: string) {
  const body = (await (await call("GET", "/api/me/profiles", cookie)).json()) as { profiles: ProfileJson[] };
  return body.profiles[0] as ProfileJson;
}

const eventsOf = (itemId: string) =>
  t.db
    .select()
    .from(schema.itemEvents)
    .where(eq(schema.itemEvents.itemId, itemId))
    .orderBy(asc(schema.itemEvents.createdAt));

const audienceEvents = (userId: string, name: string) =>
  t.db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.userId, userId), eq(schema.events.name, name)));

describe("POST /api/me/items", () => {
  it("answers 401 without a session", async () => {
    const product = await newProduct();
    expect((await call("POST", "/api/me/items", undefined, { productId: product.id, action: "wish" })).status).toBe(
      401,
    );
  });

  it("♡ keeps a spotted wish (level 2) in « Moi », with no history row", async () => {
    const { cookie, userId } = await t.signIn();
    const product = await newProduct({ brand: "Marque", priceCents: 4990, currency: "EUR" });
    const res = await call("POST", "/api/me/items", cookie, { productId: product.id, action: "wish" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ItemResult;
    const moi = await defaultProfile(cookie);
    expect(body.itemIds).toEqual([body.item.id]);
    expect(body.undo).toEqual({ ops: [{ ids: [body.item.id], op: "delete" }], removeEventIds: [] });
    expect(body.item).toMatchObject({
      profileId: moi.id,
      stage: "spotted",
      loveLevel: 2,
      priority: false,
      why: null,
      inOrderDraft: false,
      name: product.name,
      brand: "Marque",
      product: { id: product.id, priceCents: 4990 },
      photos: [],
      tags: [],
      wishlistIds: [],
      deletedAt: null,
    });
    expect(await eventsOf(body.item.id)).toEqual([]);
    expect(await audienceEvents(userId, "item_saved")).toEqual([
      expect.objectContaining({ props: { action: "wish", stage: "spotted" } }),
    ]);
  });

  it("`ordered` keeps an ordered item and writes its history row", async () => {
    const { cookie } = await t.signIn();
    const product = await newProduct();
    const body = await keep(cookie, { productId: product.id, action: "ordered" });
    expect(body.item).toMatchObject({ stage: "ordered", loveLevel: null });
    const events = await eventsOf(body.item.id);
    expect(events).toEqual([expect.objectContaining({ type: "stage", stage: "ordered", amountCents: null })]);
    expect(body.undo).toEqual({ ops: [{ ids: [body.item.id], op: "delete" }], removeEventIds: [events[0]?.id] });
  });

  it("`list` adds the new item to one of her lists, never to another user's", async () => {
    const { cookie, userId } = await t.signIn();
    const other = await t.signIn();
    const [mine] = await t.db.insert(schema.wishlists).values({ userId, name: "Envies" }).returning();
    const [theirs] = await t.db.insert(schema.wishlists).values({ userId: other.userId, name: "Autre" }).returning();
    const product = await newProduct();
    const refused = await call("POST", "/api/me/items", cookie, {
      productId: product.id,
      action: "list",
      wishlistId: theirs?.id,
    });
    expect(refused.status).toBe(404);
    const body = await keep(cookie, { productId: product.id, action: "list", wishlistId: mine?.id });
    expect(body.item).toMatchObject({ stage: "spotted", loveLevel: null, wishlistIds: [mine?.id] });
  });

  it("returns the existing item as is when the same product is kept again from another profile", async () => {
    const { cookie } = await t.signIn();
    const moi = await defaultProfile(cookie);
    const lea = await newProfile(cookie);
    const product = await newProduct();
    const first = await keep(cookie, { productId: product.id, action: "wish" });
    const res = await call("POST", "/api/me/items", cookie, {
      productId: product.id,
      profileId: lea.id,
      action: "ordered",
    });
    expect(res.status).toBe(200);
    const again = (await res.json()) as ItemResult;
    expect(again.item.id).toBe(first.item.id);
    expect(again.item).toMatchObject({ profileId: moi.id, stage: "spotted", loveLevel: 2 });
    expect(again.undo).toBeNull();
    const rows = await t.db.select().from(schema.items).where(eq(schema.items.productId, product.id));
    expect(rows).toHaveLength(1);
  });

  it("answers 404 for an unknown product or another user's profile", async () => {
    const { cookie } = await t.signIn();
    const other = await t.signIn();
    const theirs = await newProfile(other.cookie);
    const product = await newProduct();
    expect((await call("POST", "/api/me/items", cookie, { productId: UNKNOWN_ID, action: "wish" })).status).toBe(404);
    const res = await call("POST", "/api/me/items", cookie, {
      productId: product.id,
      profileId: theirs.id,
      action: "wish",
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("answers 400 for an invalid body", async () => {
    const { cookie } = await t.signIn();
    const product = await newProduct();
    const res = await call("POST", "/api/me/items", cookie, { productId: product.id, action: "list" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });

  it("refuses the 301st creation within the hour with 429", async () => {
    const { cookie } = await t.signIn();
    const shop = await newShop();
    const products = await t.db
      .insert(schema.products)
      .values(
        Array.from({ length: 301 }, (_, i) => ({
          shopId: shop.id,
          canonicalUrl: `https://me-items-limit-${shop.id}.test/${i}`,
        })),
      )
      .returning({ id: schema.products.id });
    for (let i = 0; i < 300; i += 25) {
      const statuses = await Promise.all(
        products
          .slice(i, i + 25)
          .map(async (p) => (await call("POST", "/api/me/items", cookie, { productId: p.id, action: "wish" })).status),
      );
      expect(statuses.every((s) => s === 201)).toBe(true);
    }
    const res = await call("POST", "/api/me/items", cookie, { productId: products[300]?.id, action: "wish" });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
  }, 60_000);
});

describe("GET /api/me/items/:id and PATCH", () => {
  it("reads an item and patches her fields", async () => {
    const { cookie } = await t.signIn();
    const product = await newProduct({ brand: "Marque" });
    const [category] = await t.db
      .insert(schema.categories)
      .values({ slug: `me-items-cat-${++counter}`, name: "Robes" })
      .returning();
    const { item } = await keep(cookie, { productId: product.id, action: "wish" });
    const res = await call("PATCH", `/api/me/items/${item.id}`, cookie, {
      sizeLabel: "M",
      notes: "Taille petit",
      nameOverride: "Ma robe",
      categoryId: category?.id,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ItemResult;
    expect(body.item).toMatchObject({
      sizeLabel: "M",
      notes: "Taille petit",
      name: "Ma robe",
      nameOverride: "Ma robe",
      brand: "Marque",
      categoryId: category?.id,
    });
    expect(body.undo).toEqual({
      ops: [
        {
          ids: [item.id],
          op: "setFields",
          fields: { sizeLabel: null, notes: null, nameOverride: null, categoryId: null },
        },
      ],
      removeEventIds: [],
    });
    const read = await call("GET", `/api/me/items/${item.id}`, cookie);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ id: item.id, sizeLabel: "M", name: "Ma robe" });
  });

  it("gives the previous level as undo", async () => {
    const { cookie } = await t.signIn();
    const product = await newProduct();
    const { item } = await keep(cookie, { productId: product.id, action: "wish" });
    const body = (await (
      await call("PATCH", `/api/me/items/${item.id}`, cookie, { loveLevel: 4 })
    ).json()) as ItemResult;
    expect(body.item.loveLevel).toBe(4);
    expect(body.undo).toEqual({
      ops: [{ ids: [item.id], op: "setFields", fields: { loveLevel: 2 } }],
      removeEventIds: [],
    });
  });

  it("reports nothing changed for a patch with the current values", async () => {
    const { cookie } = await t.signIn();
    const product = await newProduct();
    const { item } = await keep(cookie, { productId: product.id, action: "wish" });
    const res = await call("PATCH", `/api/me/items/${item.id}`, cookie, { loveLevel: 2, notes: null });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ItemResult;
    expect(body.itemIds).toEqual([]);
    expect(body.undo).toBeNull();
    expect(body.item.updatedAt).toBe(item.updatedAt);
  });

  it("refuses a cover that is not one of the item's photos, an unknown category or colour", async () => {
    const { cookie, userId } = await t.signIn();
    const product = await newProduct();
    const { item } = await keep(cookie, { productId: product.id, action: "wish" });
    const mediaId = randomUUID();
    await t.db.insert(schema.media).values({
      id: mediaId,
      userId,
      key: `users/${userId}/${mediaId}.webp`,
      contentType: "image/webp",
      sizeBytes: 10,
      width: 300,
      height: 400,
    });
    const notAttached = await call("PATCH", `/api/me/items/${item.id}`, cookie, { coverMediaId: mediaId });
    expect(notAttached.status).toBe(400);
    expect(await notAttached.json()).toEqual({ error: "invalid_cover" });

    await t.db.insert(schema.itemMedia).values({ itemId: item.id, mediaId, position: 0 });
    const ok = await call("PATCH", `/api/me/items/${item.id}`, cookie, { coverMediaId: mediaId });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as ItemResult;
    expect(body.item.coverMediaId).toBe(mediaId);
    expect(body.item.coverUrl).toBe(`/api/me/media/${mediaId}`);
    expect(body.item.photos).toEqual([
      { id: mediaId, url: `/api/me/media/${mediaId}`, width: 300, height: 400, source: "private" },
    ]);

    const category = await call("PATCH", `/api/me/items/${item.id}`, cookie, { categoryId: UNKNOWN_ID });
    expect(category.status).toBe(400);
    expect(await category.json()).toEqual({ error: "invalid_category" });
    const color = await call("PATCH", `/api/me/items/${item.id}`, cookie, { colorId: UNKNOWN_ID });
    expect(color.status).toBe(400);
    expect(await color.json()).toEqual({ error: "invalid_color" });
  });
});

describe("POST /api/me/items/:id/stage", () => {
  it("answers 400, never 500, for an amount above the cap", async () => {
    const { cookie } = await t.signIn();
    const product = await newProduct();
    const { item } = await keep(cookie, { productId: product.id, action: "wish" });
    const res = await call("POST", `/api/me/items/${item.id}/stage`, cookie, {
      stage: "owned",
      at: "2026-10-20T09:30:00.000Z",
      amountCents: 100_000_001,
    });
    expect(res.status).toBe(400);
  });

  it("writes the history row with its date and amount, and the paid price", async () => {
    const { cookie, userId } = await t.signIn();
    const product = await newProduct();
    const { item } = await keep(cookie, { productId: product.id, action: "wish" });
    const at = "2026-10-20T09:30:00.000Z";
    const res = await call("POST", `/api/me/items/${item.id}/stage`, cookie, { stage: "owned", at, amountCents: 3500 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ItemResult;
    expect(body.item).toMatchObject({ stage: "owned", pricePaidCents: 3500, salePriceCents: null });
    const events = await eventsOf(item.id);
    expect(events).toEqual([expect.objectContaining({ type: "stage", stage: "owned", amountCents: 3500 })]);
    expect(events[0]?.at.toISOString()).toBe(at);
    expect(body.undo).toEqual({
      ops: [
        { ids: [item.id], op: "stage", stage: "spotted", at: item.createdAt },
        { ids: [item.id], op: "setFields", fields: { pricePaidCents: null } },
      ],
      removeEventIds: [events[0]?.id],
    });
    expect(await audienceEvents(userId, "item_stage_changed")).toEqual([
      expect.objectContaining({ props: { from: "spotted", to: "owned" } }),
    ]);
  });

  it("puts a sale amount and channel on the sale fields", async () => {
    const { cookie } = await t.signIn();
    const product = await newProduct();
    const { item } = await keep(cookie, { productId: product.id, action: "ordered" });
    const res = await call("POST", `/api/me/items/${item.id}/stage`, cookie, {
      stage: "sold",
      at: "2026-11-01T10:00:00.000Z",
      amountCents: 2000,
      channel: "Vinted",
    });
    expect((await res.json()) as ItemResult).toMatchObject({
      item: { stage: "sold", salePriceCents: 2000, saleChannel: "Vinted", pricePaidCents: null },
    });
  });

  it("refuses the same stage with 400 same_stage", async () => {
    const { cookie } = await t.signIn();
    const product = await newProduct();
    const { item } = await keep(cookie, { productId: product.id, action: "wish" });
    const res = await call("POST", `/api/me/items/${item.id}/stage`, cookie, {
      stage: "spotted",
      at: "2026-11-01T10:00:00.000Z",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "same_stage" });
  });

  it("writes the channel only for the sale stages", async () => {
    const { cookie } = await t.signIn();
    const product = await newProduct();
    const { item } = await keep(cookie, { productId: product.id, action: "wish" });
    const res = await call("POST", `/api/me/items/${item.id}/stage`, cookie, {
      stage: "owned",
      at: "2026-11-01T10:00:00.000Z",
      channel: "Vinted",
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ItemResult).item.saleChannel).toBeNull();
  });

  it("replaying the undo of a stage change brings the stage back", async () => {
    const { cookie } = await t.signIn();
    const product = await newProduct();
    const { item } = await keep(cookie, { productId: product.id, action: "ordered" });
    const [orderedEvent] = await eventsOf(item.id);
    const changed = (await (
      await call("POST", `/api/me/items/${item.id}/stage`, cookie, {
        stage: "returned",
        at: "2026-11-02T10:00:00.000Z",
      })
    ).json()) as ItemResult;
    const op = changed.undo?.ops[0];
    expect(op).toEqual({ ids: [item.id], op: "stage", stage: "ordered", at: orderedEvent?.at.toISOString() });
    if (op?.op !== "stage") throw new Error("expected a stage op");
    // Task 7 replays it through /items/undo; the single-item route gives the same stage back.
    const back = await call("POST", `/api/me/items/${item.id}/stage`, cookie, { stage: op.stage, at: op.at });
    expect(((await back.json()) as ItemResult).item.stage).toBe("ordered");
  });
});

describe("POST /api/me/items/:id/move", () => {
  it("moves the item and writes from/to in the history", async () => {
    const { cookie, userId } = await t.signIn();
    const moi = await defaultProfile(cookie);
    const lea = await newProfile(cookie);
    const product = await newProduct();
    const { item } = await keep(cookie, { productId: product.id, action: "wish" });
    const res = await call("POST", `/api/me/items/${item.id}/move`, cookie, { profileId: lea.id });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ItemResult;
    expect(body.item.profileId).toBe(lea.id);
    const events = await eventsOf(item.id);
    expect(events).toEqual([
      expect.objectContaining({ type: "profile", fromProfileId: moi.id, toProfileId: lea.id, stage: null }),
    ]);
    expect(body.undo).toEqual({
      ops: [{ ids: [item.id], op: "move", profileId: moi.id }],
      removeEventIds: [events[0]?.id],
    });
    expect(await audienceEvents(userId, "item_moved")).toHaveLength(1);
    const same = await call("POST", `/api/me/items/${item.id}/move`, cookie, { profileId: lea.id });
    expect(same.status).toBe(400);
    expect(await same.json()).toEqual({ error: "same_profile" });
  });
});

describe("trash and restore", () => {
  it("trashes an item, lists it in the trash only, and restores it", async () => {
    const { cookie } = await t.signIn();
    const product = await newProduct();
    const { item } = await keep(cookie, { productId: product.id, action: "wish" });
    const del = await call("DELETE", `/api/me/items/${item.id}`, cookie);
    expect(del.status).toBe(200);
    const deleted = (await del.json()) as ItemResult;
    expect(deleted.item.deletedAt).not.toBeNull();
    expect(deleted.undo).toEqual({ ops: [{ ids: [item.id], op: "restore" }], removeEventIds: [] });

    const active = (await (await call("GET", "/api/me/items", cookie)).json()) as { items: ItemView[] };
    expect(active.items.map((i) => i.id)).not.toContain(item.id);
    const trash = (await (await call("GET", "/api/me/items?deleted=true", cookie)).json()) as { items: ItemView[] };
    expect(trash.items.map((i) => i.id)).toEqual([item.id]);

    const stage = await call("POST", `/api/me/items/${item.id}/stage`, cookie, {
      stage: "owned",
      at: "2026-11-01T10:00:00.000Z",
    });
    expect(stage.status).toBe(409);
    expect(await stage.json()).toEqual({ error: "item_deleted" });

    const res = await call("POST", `/api/me/items/${item.id}/restore`, cookie);
    expect(res.status).toBe(200);
    const restored = (await res.json()) as ItemResult;
    expect(restored.item).toMatchObject({ id: item.id, deletedAt: null });
    expect(restored.undo).toEqual({ ops: [{ ids: [item.id], op: "delete" }], removeEventIds: [] });
    const notDeleted = await call("POST", `/api/me/items/${item.id}/restore`, cookie);
    expect(notDeleted.status).toBe(409);
    expect(await notDeleted.json()).toEqual({ error: "item_not_deleted" });
  });

  it("merges a restored item into the active one for the same product", async () => {
    const { cookie, userId } = await t.signIn();
    const product = await newProduct();
    const lea = await newProfile(cookie);
    // The old item: owned, with a size, a photo, a tag, a list and history.
    const old = (await keep(cookie, { productId: product.id, profileId: lea.id, action: "ordered" })).item;
    await call("POST", `/api/me/items/${old.id}/stage`, cookie, {
      stage: "owned",
      at: "2026-10-01T10:00:00.000Z",
      amountCents: 4000,
    });
    await call("PATCH", `/api/me/items/${old.id}`, cookie, { sizeLabel: "M", notes: "Ancienne note" });
    const mediaId = randomUUID();
    await t.db.insert(schema.media).values({
      id: mediaId,
      userId,
      key: `users/${userId}/${mediaId}.webp`,
      contentType: "image/webp",
      sizeBytes: 10,
      width: 300,
      height: 400,
    });
    await t.db.insert(schema.itemMedia).values({ itemId: old.id, mediaId, position: 0 });
    const [tag] = await t.db.insert(schema.tags).values({ userId, name: "Été" }).returning();
    const [list] = await t.db.insert(schema.wishlists).values({ userId, name: "Envies" }).returning();
    if (!tag || !list) throw new Error("setup");
    await t.db.insert(schema.itemTags).values({ itemId: old.id, tagId: tag.id });
    await t.db.insert(schema.wishlistItems).values({ wishlistId: list.id, itemId: old.id });
    await call("DELETE", `/api/me/items/${old.id}`, cookie);

    // Kept again meanwhile: a fresh spotted wish with its own notes, in « Moi ».
    const fresh = (await keep(cookie, { productId: product.id, action: "wish" })).item;
    expect(fresh.id).not.toBe(old.id);
    await call("PATCH", `/api/me/items/${fresh.id}`, cookie, { notes: "Nouvelle note" });

    const res = await call("POST", `/api/me/items/${old.id}/restore`, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ItemResult;
    expect(body.itemIds).toEqual([fresh.id]);
    expect(body.undo).toBeNull();
    expect(body.item).toMatchObject({
      id: fresh.id,
      profileId: fresh.profileId,
      stage: "owned",
      loveLevel: 2,
      sizeLabel: "M",
      notes: "Nouvelle note",
      pricePaidCents: 4000,
      tags: [{ id: tag.id, name: "Été", color: null }],
      wishlistIds: [list.id],
      deletedAt: null,
    });
    expect(body.item.photos.map((p) => p.id)).toEqual([mediaId]);
    expect(await t.db.select().from(schema.items).where(eq(schema.items.id, old.id))).toEqual([]);
    const history = await eventsOf(fresh.id);
    expect(history.map((e) => e.stage)).toEqual(["ordered", "owned"]);
  });
});

describe("restore merge under concurrency", () => {
  it("merges with the target's committed values when a change on it was in flight", async () => {
    const { cookie } = await t.signIn();
    const product = await newProduct();
    const old = (await keep(cookie, { productId: product.id, action: "ordered" })).item;
    await call("DELETE", `/api/me/items/${old.id}`, cookie);
    const fresh = (await keep(cookie, { productId: product.id, action: "wish" })).item;
    // Another transaction holds the target row and moves it to « sold ».
    const client = await t.pool.connect();
    try {
      await client.query("begin");
      await client.query("update items set stage = 'sold', sale_price_cents = 2500 where id = $1", [fresh.id]);
      const restoring = call("POST", `/api/me/items/${old.id}/restore`, cookie);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await client.query("commit");
      const res = await restoring;
      expect(res.status).toBe(200);
      expect(((await res.json()) as ItemResult).item).toMatchObject({
        id: fresh.id,
        stage: "sold",
        salePriceCents: 2500,
      });
    } finally {
      client.release();
    }
    const [row] = await t.db.select().from(schema.items).where(eq(schema.items.id, fresh.id));
    expect(row).toMatchObject({ stage: "sold", salePriceCents: 2500 });
  });
});

describe("GET /api/me/items", () => {
  it("paginates 120 items stably by creation date, 48 per page", async () => {
    const { cookie, userId } = await t.signIn();
    const moi = await defaultProfile(cookie);
    const shop = await newShop();
    const products = await t.db
      .insert(schema.products)
      .values(
        Array.from({ length: 120 }, (_, i) => ({
          shopId: shop.id,
          canonicalUrl: `https://me-items-page-${shop.id}.test/${i}`,
        })),
      )
      .returning({ id: schema.products.id });
    // Two batches: within a batch every row shares created_at, so the id breaks the ties.
    const base = new Date("2026-10-01T00:00:00Z").getTime();
    await t.db.insert(schema.items).values(
      products.map((p, i) => ({
        userId,
        profileId: moi.id,
        productId: p.id,
        createdAt: new Date(base + (i < 60 ? 0 : 1000)),
      })),
    );
    const seen: string[] = [];
    const sizes: number[] = [];
    let cursor: string | null = null;
    let first = true;
    while (first || cursor) {
      const res = await call("GET", `/api/me/items${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, cookie);
      expect(res.status).toBe(200);
      const page = (await res.json()) as { items: ItemView[]; nextCursor: string | null };
      sizes.push(page.items.length);
      seen.push(...page.items.map((i) => i.id));
      if (first) {
        // A new item kept between two pages shows on top, never shifts the next pages.
        await keep(cookie, { productId: (await newProduct()).id, action: "wish" });
      }
      first = false;
      cursor = page.nextCursor;
    }
    expect(sizes).toEqual([48, 48, 24]);
    expect(new Set(seen).size).toBe(120);
    const rows = await t.db.select().from(schema.items).where(eq(schema.items.userId, userId));
    const expected = rows
      .filter((r) => r.createdAt.getTime() < base + 2000)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
      .map((r) => r.id);
    expect(seen).toEqual(expected);
  });

  it("filters by stage and profile, and sorts by price with unknown prices last", async () => {
    const { cookie } = await t.signIn();
    const lea = await newProfile(cookie);
    const cheap = await keep(cookie, { productId: (await newProduct({ priceCents: 1000 })).id, action: "wish" });
    const dear = await keep(cookie, {
      productId: (await newProduct({ priceCents: 9000 })).id,
      profileId: lea.id,
      action: "ordered",
    });
    const noPriceId = (await keep(cookie, { productId: (await newProduct()).id, action: "wish" })).item.id;

    const ids = async (query: string) =>
      ((await (await call("GET", `/api/me/items?${query}`, cookie)).json()) as { items: ItemView[] }).items.map(
        (i) => i.id,
      );
    expect(await ids("stage=ordered")).toEqual([dear.item.id]);
    expect(await ids(`profile=${lea.id}`)).toEqual([dear.item.id]);
    expect(await ids(`product=${dear.item.product.id}`)).toEqual([dear.item.id]);
    expect(await ids(`product=${UNKNOWN_ID}`)).toEqual([]);
    expect((await call("GET", "/api/me/items?product=not-a-uuid", cookie)).status).toBe(400);
    // Another account's item for the same product is never returned.
    const stranger = await t.signIn();
    await keep(stranger.cookie, { productId: dear.item.product.id, action: "wish" });
    expect(await ids(`product=${dear.item.product.id}`)).toEqual([dear.item.id]);
    expect(await ids("sort=price_asc")).toEqual([cheap.item.id, dear.item.id, noPriceId]);
    expect(await ids("sort=price_desc")).toEqual([dear.item.id, cheap.item.id, noPriceId]);
    expect(await ids("sort=oldest")).toEqual([cheap.item.id, dear.item.id, noPriceId]);
    expect((await call("GET", "/api/me/items?cursor=garbage", cookie)).status).toBe(400);
  });

  it("searches her items by name, brand or shop, case-insensitively, wildcards taken literally", async () => {
    const { cookie } = await t.signIn();
    const dress = await keep(cookie, {
      productId: (await newProduct({ name: "Robe portefeuille Lina", brand: "Sézane" })).id,
      action: "wish",
    });
    const jeans = await keep(cookie, {
      productId: (await newProduct({ name: "Jean droit 501", brand: "Levi’s" })).id,
      action: "wish",
    });
    const odd = await keep(cookie, { productId: (await newProduct({ name: "Remise 50%_off" })).id, action: "wish" });
    const ids = async (q: string) =>
      (
        (await (await call("GET", `/api/me/items?q=${encodeURIComponent(q)}`, cookie)).json()) as {
          items: ItemView[];
        }
      ).items
        .map((i) => i.id)
        .sort();
    expect(await ids("portefeuille")).toEqual([dress.item.id]);
    expect(await ids("LINA")).toEqual([dress.item.id]);
    expect(await ids("sézane")).toEqual([dress.item.id]);
    expect(await ids("levi")).toEqual([jeans.item.id]);
    // The shop's name: every product of this test has its own « Boutique I… ».
    const shopName = dress.item.product.shop.name;
    expect(await ids(shopName)).toEqual([dress.item.id]);
    expect(await ids("%")).toEqual([odd.item.id]);
    expect(await ids("0%_")).toEqual([odd.item.id]);
    expect(await ids("introuvable")).toEqual([]);
    // Spaces around are ignored; an empty search is refused.
    expect(await ids("  droit  ")).toEqual([jeans.item.id]);
    expect((await call("GET", "/api/me/items?q=%20", cookie)).status).toBe(400);
    expect((await call("GET", `/api/me/items?q=${"a".repeat(101)}`, cookie)).status).toBe(400);
  });

  it("answers 400 invalid_cursor for a forged cursor", async () => {
    const { cookie } = await t.signIn();
    const forge = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const cursors = [
      "garbage",
      forge({ s: "recent", k: ["x", "y"] }),
      forge({ s: "recent", k: ["2026-02-31 00:00:00+00", UNKNOWN_ID] }),
      forge({ s: "price_asc", k: ["0", "abc", UNKNOWN_ID] }),
      forge({ s: "price_asc", k: ["0", "99999999999", UNKNOWN_ID] }),
      forge({ s: "name", k: ["0", "x".repeat(1000), UNKNOWN_ID] }),
      forge({ s: "oldest", k: ["2026-11-01 10:00:00+00", UNKNOWN_ID] }),
    ];
    for (const cursor of cursors) {
      const res = await call("GET", `/api/me/items?cursor=${encodeURIComponent(cursor)}`, cookie);
      expect(res.status, cursor).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_cursor" });
    }
  });

  it("pages the name sort past items with 300-character accented names", async () => {
    const { cookie, userId } = await t.signIn();
    const moi = await defaultProfile(cookie);
    const shop = await newShop();
    const products = await t.db
      .insert(schema.products)
      .values(
        Array.from({ length: 49 }, (_, i) => ({
          shopId: shop.id,
          canonicalUrl: `https://me-items-names-${shop.id}.test/${i}`,
          name: "é".repeat(300),
        })),
      )
      .returning({ id: schema.products.id });
    await t.db.insert(schema.items).values(products.map((p) => ({ userId, profileId: moi.id, productId: p.id })));
    const first = (await (await call("GET", "/api/me/items?sort=name", cookie)).json()) as {
      items: ItemView[];
      nextCursor: string | null;
    };
    expect(first.items).toHaveLength(48);
    const res = await call(
      "GET",
      `/api/me/items?sort=name&cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
      cookie,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { items: ItemView[] }).items).toHaveLength(1);
  });

  it("shows the trash latest deleted first, with a stable cursor", async () => {
    const { cookie, userId } = await t.signIn();
    const moi = await defaultProfile(cookie);
    const shop = await newShop();
    const products = await t.db
      .insert(schema.products)
      .values(
        Array.from({ length: 50 }, (_, i) => ({
          shopId: shop.id,
          canonicalUrl: `https://me-items-trash-${shop.id}.test/${i}`,
        })),
      )
      .returning({ id: schema.products.id });
    const base = new Date("2026-10-01T00:00:00Z").getTime();
    // Created in one order, deleted in the reverse one (two share a deletion date: the id breaks the tie).
    const rows = await t.db
      .insert(schema.items)
      .values(
        products.map((p, i) => ({
          userId,
          profileId: moi.id,
          productId: p.id,
          createdAt: new Date(base + i * 1000),
          deletedAt: new Date(base + 1_000_000 - Math.min(i, 48) * 1000),
        })),
      )
      .returning();
    const expected = rows
      .sort((a, b) => (b.deletedAt?.getTime() ?? 0) - (a.deletedAt?.getTime() ?? 0) || (a.id < b.id ? 1 : -1))
      .map((r) => r.id);
    const first = (await (await call("GET", "/api/me/items?deleted=true", cookie)).json()) as {
      items: ItemView[];
      nextCursor: string | null;
    };
    expect(first.items).toHaveLength(48);
    expect(first.nextCursor).not.toBeNull();
    const second = (await (
      await call("GET", `/api/me/items?deleted=true&cursor=${encodeURIComponent(first.nextCursor ?? "")}`, cookie)
    ).json()) as { items: ItemView[]; nextCursor: string | null };
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map((i) => i.id)).toEqual(expected);
  });
});

describe("levels, priority and opinion", () => {
  it("keeps a wish with its level, priority and opinion", async () => {
    const { cookie } = await t.signIn();
    const product = await newProduct();
    const res = await call("POST", "/api/me/items", cookie, {
      productId: product.id,
      action: "wish",
      loveLevel: 3,
      priority: true,
      why: "Trop mims",
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as ItemResult).item).toMatchObject({
      stage: "spotted",
      loveLevel: 3,
      priority: true,
      why: "Trop mims",
      inOrderDraft: false,
    });
    const plain = await keep(cookie, { productId: (await newProduct()).id, action: "wish" });
    expect(plain.item).toMatchObject({ loveLevel: 2, priority: false, why: null });
  });

  it("refuses a level outside 1–4 and an opinion over 200 characters", async () => {
    const { cookie } = await t.signIn();
    const product = await newProduct();
    for (const extra of [{ loveLevel: 5 }, { loveLevel: 0 }, { why: "x".repeat(201) }]) {
      const res = await call("POST", "/api/me/items", cookie, { productId: product.id, action: "wish", ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    const { item } = await keep(cookie, { productId: product.id, action: "wish" });
    for (const patch of [{ loveLevel: 5 }, { loveLevel: 0 }, { why: "x".repeat(201) }]) {
      expect((await call("PATCH", `/api/me/items/${item.id}`, cookie, patch)).status).toBe(400);
    }
    const ok = await call("PATCH", `/api/me/items/${item.id}`, cookie, { why: "x".repeat(200), inOrderDraft: true });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as ItemResult).item).toMatchObject({ why: "x".repeat(200), inOrderDraft: true });
  });

  it("clearing the level never deletes the item", async () => {
    const { cookie } = await t.signIn();
    const { item } = await keep(cookie, { productId: (await newProduct()).id, action: "wish" });
    const res = await call("PATCH", `/api/me/items/${item.id}`, cookie, { loveLevel: null });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ItemResult;
    expect(body.item).toMatchObject({ id: item.id, loveLevel: null, deletedAt: null });
    expect(body.undo).toEqual({
      ops: [{ ids: [item.id], op: "setFields", fields: { loveLevel: 2 } }],
      removeEventIds: [],
    });
    const read = await call("GET", `/api/me/items/${item.id}`, cookie);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ loveLevel: null, deletedAt: null });
  });

  it("filters by levels and priority, sorts by love", async () => {
    const { cookie } = await t.signIn();
    const four = await keep(cookie, { productId: (await newProduct()).id, action: "wish", loveLevel: 4 });
    const two = await keep(cookie, { productId: (await newProduct()).id, action: "wish" });
    const none = await keep(cookie, { productId: (await newProduct()).id, action: "ordered" });
    const fourFirst = await keep(cookie, {
      productId: (await newProduct()).id,
      action: "wish",
      loveLevel: 4,
      priority: true,
    });
    const ids = async (query: string) => {
      const res = await call("GET", `/api/me/items?${query}`, cookie);
      expect(res.status, query).toBe(200);
      return ((await res.json()) as { items: ItemView[] }).items.map((i) => i.id);
    };
    expect((await ids("loveLevel=4")).toSorted()).toEqual([four.item.id, fourFirst.item.id].toSorted());
    expect((await ids("loveLevel=4,2")).toSorted()).toEqual([four.item.id, two.item.id, fourFirst.item.id].toSorted());
    expect(await ids("priority=true")).toEqual([fourFirst.item.id]);
    expect(await ids("sort=love")).toEqual([fourFirst.item.id, four.item.id, two.item.id, none.item.id]);
    for (const bad of ["loveLevel=5", "loveLevel=0", "loveLevel=", "loveLevel=4,x", "loveLevel=2.5"]) {
      expect((await call("GET", `/api/me/items?${bad}`, cookie)).status, bad).toBe(400);
    }
    await call("PATCH", `/api/me/items/${two.item.id}`, cookie, { inOrderDraft: true });
    expect(await ids("orderDraft=true")).toEqual([two.item.id]);
  });

  it("pages the love sort with a stable cursor", async () => {
    const { cookie, userId } = await t.signIn();
    const moi = await defaultProfile(cookie);
    const shop = await newShop();
    const products = await t.db
      .insert(schema.products)
      .values(
        Array.from({ length: 60 }, (_, i) => ({
          shopId: shop.id,
          canonicalUrl: `https://me-love-${shop.id}.test/${i}`,
        })),
      )
      .returning({ id: schema.products.id });
    const base = new Date("2026-10-01T00:00:00Z").getTime();
    await t.db.insert(schema.items).values(
      products.map((p, i) => ({
        userId,
        profileId: moi.id,
        productId: p.id,
        loveLevel: [null, 1, 2, 3, 4][i % 5] ?? null,
        priority: i % 7 === 0,
        // Ties on the date: the id breaks them.
        createdAt: new Date(base + (i % 3) * 1000),
      })),
    );
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await call(
        "GET",
        `/api/me/items?sort=love${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        cookie,
      );
      expect(res.status).toBe(200);
      const page = (await res.json()) as { items: ItemView[]; nextCursor: string | null };
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
    } while (cursor);
    const rows = await t.db.select().from(schema.items).where(eq(schema.items.userId, userId));
    const expected = rows
      .toSorted(
        (a, b) =>
          (b.loveLevel ?? 0) - (a.loveLevel ?? 0) ||
          Number(b.priority) - Number(a.priority) ||
          b.createdAt.getTime() - a.createdAt.getTime() ||
          (a.id < b.id ? 1 : -1),
      )
      .map((r) => r.id);
    expect(seen).toEqual(expected);
  });
});

describe("purge from the trash", () => {
  async function withPhoto(userId: string, itemId: string) {
    const key = `users/${userId}/${randomUUID()}.webp`;
    await t.store.put(key, Buffer.from("webp"), "image/webp");
    const [media] = await t.db
      .insert(schema.media)
      .values({ id: randomUUID(), userId, key, contentType: "image/webp", sizeBytes: 4, width: 3, height: 4 })
      .returning();
    if (!media) throw new Error("no media");
    await t.db.insert(schema.itemMedia).values({ itemId, mediaId: media.id, position: 0 });
    return { key, mediaId: media.id };
  }

  it("deletes a trashed item for good, with its photo rows and stored objects", async () => {
    const { cookie, userId } = await t.signIn();
    const product = await newProduct();
    const { item } = await keep(cookie, { productId: product.id, action: "wish" });
    const photo = await withPhoto(userId, item.id);
    await call("DELETE", `/api/me/items/${item.id}`, cookie);
    const res = await call("DELETE", `/api/me/items/${item.id}/purge`, cookie);
    expect(res.status).toBe(204);
    expect(await t.db.select().from(schema.items).where(eq(schema.items.id, item.id))).toHaveLength(0);
    expect(await t.db.select().from(schema.media).where(eq(schema.media.id, photo.mediaId))).toHaveLength(0);
    await expect(t.store.get(photo.key)).rejects.toThrow();
    expect((await call("DELETE", `/api/me/items/${item.id}/purge`, cookie)).status).toBe(404);
  });

  it("refuses an active item with 409 item_not_deleted", async () => {
    const { cookie } = await t.signIn();
    const product = await newProduct();
    const { item } = await keep(cookie, { productId: product.id, action: "wish" });
    const res = await call("DELETE", `/api/me/items/${item.id}/purge`, cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "item_not_deleted" });
    expect(await t.db.select().from(schema.items).where(eq(schema.items.id, item.id))).toHaveLength(1);
  });

  it("answers 404 for another account's trashed item, and leaves it alone", async () => {
    const owner = await t.signIn();
    const other = await t.signIn();
    const product = await newProduct();
    const { item } = await keep(owner.cookie, { productId: product.id, action: "wish" });
    await call("DELETE", `/api/me/items/${item.id}`, owner.cookie);
    for (const [cookie, id] of [
      [other.cookie, item.id],
      [owner.cookie, UNKNOWN_ID],
    ] as const) {
      const res = await call("DELETE", `/api/me/items/${id}/purge`, cookie);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
    expect(await t.db.select().from(schema.items).where(eq(schema.items.id, item.id))).toHaveLength(1);
  });
});

describe("items of a list", () => {
  it("lists a list's items in the list's order, paged, without trashed ones", async () => {
    const { cookie } = await t.signIn();
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      const product = await newProduct();
      ids.push((await keep(cookie, { productId: product.id, action: "wish" })).item.id);
    }
    const created = await call("POST", "/api/me/wishlists", cookie, { name: "Ordre" });
    const list = (await created.json()) as { id: string };
    await call("POST", "/api/me/items/bulk", cookie, { op: "addToList", ids, wishlistId: list.id });
    const reversed = [...ids].reverse();
    expect((await call("POST", `/api/me/wishlists/${list.id}/order`, cookie, { ids: reversed })).status).toBe(200);
    await call("DELETE", `/api/me/items/${reversed[3]}`, cookie);
    const expected = reversed.filter((id) => id !== reversed[3]);

    const first = (await (await call("GET", `/api/me/items?wishlist=${list.id}`, cookie)).json()) as {
      items: ItemView[];
      nextCursor: string | null;
    };
    expect(first.items).toHaveLength(48);
    expect(first.nextCursor).not.toBeNull();
    const second = (await (
      await call("GET", `/api/me/items?wishlist=${list.id}&cursor=${first.nextCursor}`, cookie)
    ).json()) as { items: ItemView[]; nextCursor: string | null };
    expect([...first.items, ...second.items].map((i) => i.id)).toEqual(expected);
    expect(second.nextCursor).toBeNull();
  });

  it("answers 404 for an unknown or another account's list", async () => {
    const owner = await t.signIn();
    const other = await t.signIn();
    const list = (await (await call("POST", "/api/me/wishlists", owner.cookie, { name: "Privée" })).json()) as {
      id: string;
    };
    for (const [cookie, id] of [
      [other.cookie, list.id],
      [owner.cookie, UNKNOWN_ID],
    ] as const) {
      const res = await call("GET", `/api/me/items?wishlist=${id}`, cookie);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
  });
});

describe("isolation", () => {
  it("answers 404 on every item route for another user's item", async () => {
    const owner = await t.signIn();
    const other = await t.signIn();
    const theirProfile = await defaultProfile(other.cookie);
    const product = await newProduct();
    const { item } = await keep(owner.cookie, { productId: product.id, action: "wish" });
    const at = "2026-11-01T10:00:00.000Z";
    const attempts: [string, string, unknown?][] = [
      ["GET", `/api/me/items/${item.id}`],
      ["PATCH", `/api/me/items/${item.id}`, { notes: "volé" }],
      ["POST", `/api/me/items/${item.id}/stage`, { stage: "owned", at }],
      ["POST", `/api/me/items/${item.id}/move`, { profileId: theirProfile.id }],
      ["DELETE", `/api/me/items/${item.id}`],
      ["POST", `/api/me/items/${item.id}/restore`],
      ["GET", `/api/me/items/${UNKNOWN_ID}`],
    ];
    for (const [method, path, body] of attempts) {
      const res = await call(method, path, other.cookie, body);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
    // Moving her own item into another user's profile.
    const own = await keep(other.cookie, { productId: product.id, action: "wish" });
    const ownerProfile = await defaultProfile(owner.cookie);
    expect(
      (await call("POST", `/api/me/items/${own.item.id}/move`, other.cookie, { profileId: ownerProfile.id })).status,
    ).toBe(404);
    const list = (await (await call("GET", "/api/me/items", other.cookie)).json()) as { items: ItemView[] };
    expect(list.items.map((i) => i.id)).toEqual([own.item.id]);
    // Filtering by another user's profile shows nothing of hers.
    const filtered = (await (await call("GET", `/api/me/items?profile=${ownerProfile.id}`, other.cookie)).json()) as {
      items: ItemView[];
    };
    expect(filtered.items).toEqual([]);
    const [row] = await t.db.select().from(schema.items).where(eq(schema.items.id, item.id));
    expect(row).toMatchObject({ notes: null, stage: "spotted", deletedAt: null });
  });
});
