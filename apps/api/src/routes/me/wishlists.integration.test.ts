import { randomUUID } from "node:crypto";
import { and, eq, schema } from "@closyria/db";
import type { SharedWishlistView, WishlistView } from "@closyria/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";
import { hashShareToken } from "../../wardrobe/share-token";

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

function call(method: string, path: string, cookie: string | undefined, body?: unknown) {
  return t.app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

async function createList(cookie: string, name = "Été") {
  const res = await call("POST", "/api/me/wishlists", cookie, { name });
  expect(res.status).toBe(201);
  return (await res.json()) as WishlistView;
}

async function defaultProfileId(cookie: string) {
  const body = (await (await call("GET", "/api/me/profiles", cookie)).json()) as { profiles: { id: string }[] };
  return (body.profiles[0] as { id: string }).id;
}

/** An item on a fresh product (with `images` shop photos), straight in the database. */
async function newItem(
  cookie: string,
  userId: string,
  product: Partial<typeof schema.products.$inferInsert> = {},
  images = 1,
  item: Partial<typeof schema.items.$inferInsert> = {},
) {
  const k = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `Boutique W${k}`, slug: `me-wl-shop-${k}` })
    .returning();
  if (!shop) throw new Error("no shop");
  const [p] = await t.db
    .insert(schema.products)
    .values({
      shopId: shop.id,
      canonicalUrl: `https://me-wl-${k}.test/p`,
      name: `Robe ${k}`,
      brand: "Maison",
      priceCents: 4990,
      currency: "EUR",
      ...product,
    })
    .returning();
  if (!p) throw new Error("no product");
  const imageRows =
    images > 0
      ? await t.db
          .insert(schema.productImages)
          .values(
            Array.from({ length: images }, (_, i) => ({
              productId: p.id,
              position: i,
              key: `k${k}-${i}`,
              width: 600,
              height: 800,
              sourceHash: `h${k}-${i}`,
            })),
          )
          .returning()
      : [];
  const [row] = await t.db
    .insert(schema.items)
    .values({ userId, profileId: await defaultProfileId(cookie), productId: p.id, ...item })
    .returning();
  if (!row) throw new Error("no item");
  return { item: row, product: p, images: imageRows, shop };
}

async function addItem(cookie: string, listId: string, itemId: string) {
  return call("POST", `/api/me/wishlists/${listId}/items`, cookie, { itemId });
}

async function share(cookie: string, listId: string) {
  const res = await call("POST", `/api/me/wishlists/${listId}/share`, cookie);
  expect(res.status).toBe(200);
  const { url } = (await res.json()) as { url: string };
  expect(url).toMatch(/^\/l\/[A-Za-z0-9_-]{22}$/);
  return url.slice("/l/".length);
}

const getShared = (token: string) => t.app.request(`/api/shared/${token}`, { headers: {} });

describe("/api/me/wishlists", () => {
  it("answers 401 without a session", async () => {
    expect((await call("GET", "/api/me/wishlists", undefined)).status).toBe(401);
  });

  it("creates, lists in order, renames and deletes her lists", async () => {
    const { cookie } = await t.signIn();
    const a = await createList(cookie, "  Été ");
    const b = await createList(cookie, "Hiver");
    expect(a).toMatchObject({ name: "Été", itemIds: [], shared: false, sharedAt: null });
    expect(b.position).toBeGreaterThan(a.position);
    const list = (await (await call("GET", "/api/me/wishlists", cookie)).json()) as { wishlists: WishlistView[] };
    expect(list.wishlists.map((w) => w.name)).toEqual(["Été", "Hiver"]);

    const renamed = await call("PATCH", `/api/me/wishlists/${a.id}`, cookie, { name: "Plage" });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as WishlistView).name).toBe("Plage");
    expect((await call("POST", "/api/me/wishlists", cookie, { name: "" })).status).toBe(400);
    expect((await call("POST", "/api/me/wishlists", cookie, { name: "x".repeat(81) })).status).toBe(400);

    expect((await call("DELETE", `/api/me/wishlists/${b.id}`, cookie)).status).toBe(204);
    expect((await call("DELETE", `/api/me/wishlists/${b.id}`, cookie)).status).toBe(404);
  });

  it("adds items (idempotent), removes them, and deleting a list keeps the items", async () => {
    const { cookie, userId } = await t.signIn();
    const list = await createList(cookie);
    const { item } = await newItem(cookie, userId);
    const added = await addItem(cookie, list.id, item.id);
    expect(added.status).toBe(200);
    expect(((await added.json()) as WishlistView).itemIds).toEqual([item.id]);
    const again = await addItem(cookie, list.id, item.id);
    expect(((await again.json()) as WishlistView).itemIds).toEqual([item.id]);

    const removed = await call("DELETE", `/api/me/wishlists/${list.id}/items/${item.id}`, cookie);
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as WishlistView).itemIds).toEqual([]);

    await addItem(cookie, list.id, item.id);
    expect((await call("DELETE", `/api/me/wishlists/${list.id}`, cookie)).status).toBe(204);
    const [kept] = await t.db.select().from(schema.items).where(eq(schema.items.id, item.id));
    expect(kept).toBeDefined();
  });

  it("answers 404 to another account on every route, and 404 for unknown ids", async () => {
    const mine = await t.signIn();
    const other = await t.signIn();
    const list = await createList(mine.cookie);
    const { item } = await newItem(mine.cookie, mine.userId);
    const theirs = await createList(other.cookie, "Autre");
    const theirItem = await newItem(other.cookie, other.userId);
    await addItem(mine.cookie, list.id, item.id);

    const forbidden: [string, string, unknown?][] = [
      ["PATCH", `/api/me/wishlists/${list.id}`, { name: "x" }],
      ["DELETE", `/api/me/wishlists/${list.id}`],
      ["POST", `/api/me/wishlists/${list.id}/items`, { itemId: theirItem.item.id }],
      ["POST", `/api/me/wishlists/${list.id}/items`, { itemId: item.id }],
      ["DELETE", `/api/me/wishlists/${list.id}/items/${item.id}`],
      ["POST", `/api/me/wishlists/${list.id}/order`, { ids: [item.id] }],
      ["POST", `/api/me/wishlists/${list.id}/share`],
      ["DELETE", `/api/me/wishlists/${list.id}/share`],
      ["PATCH", `/api/me/wishlists/${UNKNOWN_ID}`, { name: "x" }],
      ["POST", `/api/me/wishlists/${UNKNOWN_ID}/share`],
    ];
    for (const [method, path, body] of forbidden) {
      const res = await call(method, path, other.cookie, body);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    // Her own list with an item of someone else, and an unknown item: 404.
    expect((await addItem(other.cookie, theirs.id, item.id)).status).toBe(404);
    expect((await addItem(other.cookie, theirs.id, UNKNOWN_ID)).status).toBe(404);
    // Nothing changed for the owner.
    const after = (await (await call("GET", "/api/me/wishlists", mine.cookie)).json()) as { wishlists: WishlistView[] };
    expect(after.wishlists[0]).toMatchObject({ name: "Été", itemIds: [item.id], shared: false });
    // The other account does not see my lists.
    const theirList = (await (await call("GET", "/api/me/wishlists", other.cookie)).json()) as {
      wishlists: WishlistView[];
    };
    expect(theirList.wishlists.map((w) => w.id)).toEqual([theirs.id]);
  });

  it("refuses to add an item in the trash (item_deleted) and hides it from the list view", async () => {
    const { cookie, userId } = await t.signIn();
    const list = await createList(cookie);
    const trashed = await newItem(cookie, userId, {}, 1, { deletedAt: new Date() });
    const res = await addItem(cookie, list.id, trashed.item.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "item_deleted" });

    const live = await newItem(cookie, userId);
    await addItem(cookie, list.id, live.item.id);
    await t.db.update(schema.items).set({ deletedAt: new Date() }).where(eq(schema.items.id, live.item.id));
    const views = (await (await call("GET", "/api/me/wishlists", cookie)).json()) as { wishlists: WishlistView[] };
    expect(views.wishlists[0]?.itemIds).toEqual([]);
  });

  it("orders the items of a list; a wrong set of ids answers 400", async () => {
    const { cookie, userId } = await t.signIn();
    const list = await createList(cookie);
    const items = [];
    for (let i = 0; i < 3; i++) {
      const made = await newItem(cookie, userId);
      items.push(made.item.id);
      await addItem(cookie, list.id, made.item.id);
    }
    const [a, b, c] = items as [string, string, string];
    const ordered = await call("POST", `/api/me/wishlists/${list.id}/order`, cookie, { ids: [c, a, b] });
    expect(ordered.status).toBe(200);
    expect(((await ordered.json()) as WishlistView).itemIds).toEqual([c, a, b]);
    const reread = (await (await call("GET", "/api/me/wishlists", cookie)).json()) as { wishlists: WishlistView[] };
    expect(reread.wishlists[0]?.itemIds).toEqual([c, a, b]);

    for (const ids of [
      [a, b],
      [a, b, c, UNKNOWN_ID],
      [a, a, b],
      [a, b, randomUUID()],
    ]) {
      const res = await call("POST", `/api/me/wishlists/${list.id}/order`, cookie, { ids });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
    }
    expect(
      ((await (await call("GET", "/api/me/wishlists", cookie)).json()) as { wishlists: WishlistView[] }).wishlists[0]
        ?.itemIds,
    ).toEqual([c, a, b]);
  });
});

describe("POST /api/me/wishlists/order", () => {
  const ordered = async (cookie: string) =>
    ((await (await call("GET", "/api/me/wishlists", cookie)).json()) as { wishlists: WishlistView[] }).wishlists.map(
      (w) => w.id,
    );

  it("reorders her lists; a wrong set answers 400", async () => {
    const { cookie } = await t.signIn();
    const [a, b, c] = [await createList(cookie, "A"), await createList(cookie, "B"), await createList(cookie, "C")];
    const ids = [c, a, b].map((w) => w.id);
    const res = await call("POST", "/api/me/wishlists/order", cookie, { ids });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { wishlists: WishlistView[] }).wishlists.map((w) => w.id)).toEqual(ids);
    expect(await ordered(cookie)).toEqual(ids);
    for (const bad of [ids.slice(1), [...ids, a.id], []]) {
      const r = await call("POST", "/api/me/wishlists/order", cookie, { ids: bad });
      expect(r.status).toBe(400);
    }
    expect(await ordered(cookie)).toEqual(ids);
  });

  it("answers 400 invalid_request for a strict subset of her lists and changes nothing", async () => {
    const { cookie } = await t.signIn();
    const a = await createList(cookie, "A");
    const b = await createList(cookie, "B");
    const c = await createList(cookie, "C");
    const res = await call("POST", "/api/me/wishlists/order", cookie, { ids: [c.id, a.id] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
    expect(await ordered(cookie)).toEqual([a.id, b.id, c.id]);
  });

  it("answers 404 for a foreign or unknown list and changes nothing", async () => {
    const mine = await t.signIn();
    const other = await t.signIn();
    const a = await createList(mine.cookie, "A");
    const b = await createList(mine.cookie, "B");
    const theirs = await createList(other.cookie, "X");
    for (const ids of [[b.id, a.id, theirs.id], [UNKNOWN_ID]]) {
      const res = await call("POST", "/api/me/wishlists/order", mine.cookie, { ids });
      expect(res.status).toBe(404);
    }
    const res = await call("POST", "/api/me/wishlists/order", other.cookie, { ids: [a.id] });
    expect(res.status).toBe(404);
    expect(await ordered(mine.cookie)).toEqual([a.id, b.id]);
    expect(await ordered(other.cookie)).toEqual([theirs.id]);
  });
});

describe("sharing", () => {
  it("returns /l/<token> once, stores only its SHA-256, and records one wishlist_shared event without ids", async () => {
    const { cookie, userId } = await t.signIn();
    const list = await createList(cookie);
    const token = await share(cookie, list.id);
    const [row] = await t.db.select().from(schema.wishlists).where(eq(schema.wishlists.id, list.id));
    expect(row?.shareTokenHash).toBe(hashShareToken(token));
    expect(row?.sharedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(row)).not.toContain(token);
    // Nowhere in the database: scan the text of the whole row set of her lists and events.
    const events = await t.db
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.userId, userId), eq(schema.events.name, "wishlist_shared")));
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain(token);
    expect(JSON.stringify(events)).not.toContain(list.id);

    const views = (await (await call("GET", "/api/me/wishlists", cookie)).json()) as { wishlists: WishlistView[] };
    expect(views.wishlists[0]).toMatchObject({ shared: true, sharedAt: expect.any(String) });
    expect(JSON.stringify(views)).not.toContain(token);
  });

  it("a new share invalidates the old link; stopping the share answers 404 and clears the hash", async () => {
    const { cookie } = await t.signIn();
    const list = await createList(cookie);
    const first = await share(cookie, list.id);
    expect((await getShared(first)).status).toBe(200);
    const second = await share(cookie, list.id);
    expect(second).not.toBe(first);
    expect((await getShared(first)).status).toBe(404);
    expect((await getShared(second)).status).toBe(200);

    expect((await call("DELETE", `/api/me/wishlists/${list.id}/share`, cookie)).status).toBe(204);
    const stopped = await getShared(second);
    expect(stopped.status).toBe(404);
    expect(stopped.headers.get("cache-control")).toContain("no-store");
    const [row] = await t.db.select().from(schema.wishlists).where(eq(schema.wishlists.id, list.id));
    expect(row?.shareTokenHash).toBeNull();
    expect(row?.sharedAt).toBeNull();
    // Stopping again is harmless.
    expect((await call("DELETE", `/api/me/wishlists/${list.id}/share`, cookie)).status).toBe(204);
  });

  it("answers 404 to a malformed or unknown token, with the noindex and no-store headers", async () => {
    for (const token of ["abc", "x".repeat(22), "x".repeat(23), "%00", "a b"]) {
      const res = await t.app.request(`/api/shared/${encodeURIComponent(token)}`);
      expect(res.status, token).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
      expect(res.headers.get("cache-control")).toContain("no-store");
    }
    const long = await t.app.request(`/api/shared/${"a".repeat(300)}`);
    expect(long.status).toBe(404);
    expect(await long.json()).toEqual({ error: "not_found" });
    expect(long.headers.get("x-robots-tag")).toBe("noindex");
    expect(long.headers.get("cache-control")).toContain("no-store");
  });

  it("deleting the list ends the share", async () => {
    const { cookie } = await t.signIn();
    const list = await createList(cookie);
    const token = await share(cookie, list.id);
    await call("DELETE", `/api/me/wishlists/${list.id}`, cookie);
    expect((await getShared(token)).status).toBe(404);
  });

  it("shows only public product data: no notes, sizes, profile, private photo, nor ids", async () => {
    const { cookie, userId } = await t.signIn();
    const list = await createList(cookie, "Mes envies");
    const mediaId = randomUUID();
    await t.db.insert(schema.media).values({
      id: mediaId,
      userId,
      key: `private/${mediaId}`,
      contentType: "image/jpeg",
      sizeBytes: 10,
      width: 3,
      height: 4,
    });
    const made = await newItem(cookie, userId, { name: "Robe rouge", brand: "Maison" }, 2, {
      notes: "SECRET-NOTE",
      sizeLabel: "SECRET-M",
      sizeNote: "SECRET-SIZE-NOTE",
      coverMediaId: mediaId,
      nameOverride: "SECRET-OVERRIDE",
    });
    await t.db.insert(schema.itemMedia).values({ itemId: made.item.id, mediaId, position: 0 });
    await addItem(cookie, list.id, made.item.id);
    const token = await share(cookie, list.id);

    const res = await getShared(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("cache-control")).toContain("no-store");
    const raw = await res.text();
    for (const secret of ["SECRET", mediaId, userId, made.item.id, list.id, made.item.profileId ?? "-", "private/"]) {
      expect(raw).not.toContain(secret);
    }
    const parsed = JSON.parse(raw) as SharedWishlistView;
    expect(Object.keys(parsed).toSorted()).toEqual(["items", "name"]);
    expect(parsed.name).toBe("Mes envies");
    expect(parsed.items).toHaveLength(1);
    expect(Object.keys(parsed.items[0] ?? {}).toSorted()).toEqual([
      "brand",
      "currency",
      "imageUrl",
      "name",
      "priceCents",
      "shopName",
      "url",
    ]);
    expect(parsed.items[0]).toEqual({
      name: "Robe rouge",
      brand: "Maison",
      priceCents: 4990,
      currency: "EUR",
      imageUrl: `/api/catalog-images/${made.images[0]?.id}`,
      shopName: made.shop.name,
      url: made.product.canonicalUrl,
    });
  });

  it("follows the list order, drops trashed items, keeps sold ones, and shows a product without price or photo", async () => {
    const { cookie, userId } = await t.signIn();
    const list = await createList(cookie);
    const a = await newItem(cookie, userId, { name: "A" });
    const b = await newItem(cookie, userId, { name: "B" }, 1, { stage: "sold" });
    const c = await newItem(cookie, userId, { name: "C" });
    const d = await newItem(cookie, userId, { name: "D", priceCents: null, currency: null, brand: null }, 0);
    for (const x of [a, b, c, d]) await addItem(cookie, list.id, x.item.id);
    await call("POST", `/api/me/wishlists/${list.id}/order`, cookie, {
      ids: [d, c, b, a].map((x) => x.item.id),
    });
    await t.db.update(schema.items).set({ deletedAt: new Date() }).where(eq(schema.items.id, c.item.id));
    const token = await share(cookie, list.id);
    const shared = (await (await getShared(token)).json()) as SharedWishlistView;
    expect(shared.items.map((i) => i.name)).toEqual(["D", "B", "A"]);
    expect(shared.items[0]).toMatchObject({ priceCents: null, currency: null, brand: null, imageUrl: null });
  });
});
