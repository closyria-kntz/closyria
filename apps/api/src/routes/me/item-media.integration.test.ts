import { randomUUID } from "node:crypto";
import { asc, eq, schema, sql } from "@closyria/db";
import type { ItemView, MutationResult } from "@closyria/shared";
import sharp from "sharp";
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

function call(method: string, path: string, cookie: string | undefined, body?: unknown) {
  return t.app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

const jpegWithGps = () =>
  sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 10, g: 90, b: 160 } } })
    .jpeg()
    .withExif({
      IFD0: { Make: "Apple" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "48/1 51/1 2400/100",
        GPSLongitudeRef: "E",
        GPSLongitude: "2/1 21/1 300/100",
      },
    })
    .toBuffer();

function upload(itemId: string, cookie: string | undefined, body: Buffer | null, headers: Record<string, string> = {}) {
  const form = new FormData();
  if (body) form.set("file", new File([new Uint8Array(body)], "photo.jpg", { type: "image/jpeg" }));
  return t.app.request(`/api/me/items/${itemId}/media`, {
    method: "POST",
    body: form,
    headers: { origin: BASE_URL, ...headers, ...(cookie ? { cookie } : {}) },
  });
}

async function newItem(cookie: string, images = 0) {
  const n = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `Boutique P${n}`, slug: `item-media-shop-${n}` })
    .returning();
  if (!shop) throw new Error("no shop");
  const [product] = await t.db
    .insert(schema.products)
    .values({ shopId: shop.id, canonicalUrl: `https://item-media-${n}.test/p`, name: `Robe ${n}` })
    .returning();
  if (!product) throw new Error("no product");
  for (let i = 0; i < images; i++) {
    await t.db.insert(schema.productImages).values({
      productId: product.id,
      position: i,
      key: `catalog/${product.id}/${i}.webp`,
      width: 300,
      height: 400,
      sourceHash: `h${i}`,
    });
  }
  const res = await call("POST", "/api/me/items", cookie, { productId: product.id, action: "wish" });
  expect([200, 201]).toContain(res.status);
  return ((await res.json()) as ItemResult).item;
}

async function send(itemId: string, cookie: string) {
  const res = await upload(itemId, cookie, await jpegWithGps());
  expect(res.status).toBe(201);
  return (await res.json()) as ItemResult;
}

describe("/api/me/items/:id/media", () => {
  it("answers 401 without a session", async () => {
    expect((await upload(UNKNOWN_ID, undefined, await jpegWithGps())).status).toBe(401);
    expect((await call("GET", `/api/me/media/${UNKNOWN_ID}`, undefined)).status).toBe(401);
  });

  it("attaches a photo, shown on the item, stored as WebP without GPS", async () => {
    const { cookie, userId } = await t.signIn();
    const item = await newItem(cookie);
    const body = await send(item.id, cookie);
    expect(body.undo).toBeNull();
    expect(body.item.photos).toHaveLength(1);
    const photo = body.item.photos[0];
    expect(photo).toMatchObject({ source: "private", url: `/api/me/media/${photo?.id}` });
    expect(body.item.coverUrl).toBe(photo?.url);

    const get = await call("GET", `/api/me/items/${item.id}`, cookie);
    expect(((await get.json()) as ItemView).photos).toHaveLength(1);

    const [row] = await t.db
      .select()
      .from(schema.media)
      .where(eq(schema.media.id, photo?.id ?? ""));
    expect(row?.userId).toBe(userId);
    const stored = await t.store.get(row?.key ?? "");
    const meta = await sharp(stored).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();

    const file = await call("GET", photo?.url ?? "", cookie);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/webp");
    expect(file.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await file.arrayBuffer()).equals(stored)).toBe(true);
  });

  it("lists private photos first, then the shop's; the cover falls back to the first shop photo", async () => {
    const { cookie } = await t.signIn();
    const item = await newItem(cookie, 2);
    const body = await send(item.id, cookie);
    expect(body.item.photos.map((p) => p.source)).toEqual(["private", "shop", "shop"]);
    expect(body.item.coverMediaId).toBeNull();
    expect(body.item.coverUrl).toBe(body.item.photos[1]?.url);
  });

  it("falls back to her first private photo when the shop has none", async () => {
    const { cookie } = await t.signIn();
    const item = await newItem(cookie);
    await send(item.id, cookie);
    const body = await send(item.id, cookie);
    expect(body.item.coverUrl).toBe(body.item.photos[0]?.url);
  });

  it("refuses the 11th photo with 409 too_many_photos, even with two sent at once at 9", async () => {
    const { cookie, userId } = await t.signIn();
    const item = await newItem(cookie);
    for (let i = 0; i < 9; i++) await send(item.id, cookie);
    const png = await jpegWithGps();
    const [a, b] = await Promise.all([upload(item.id, cookie, png), upload(item.id, cookie, png)]);
    expect([a?.status, b?.status].toSorted()).toEqual([201, 409]);
    const loser = a?.status === 409 ? a : b;
    expect(await loser?.json()).toEqual({ error: "too_many_photos" });
    expect(await t.db.select().from(schema.itemMedia).where(eq(schema.itemMedia.itemId, item.id))).toHaveLength(10);
    // The refused photo leaves no row behind.
    expect(await t.db.select().from(schema.media).where(eq(schema.media.userId, userId))).toHaveLength(10);
  });

  it("answers 404 for another account's item, and 400 invalid_upload without a file", async () => {
    const mine = await t.signIn();
    const other = await t.signIn();
    const item = await newItem(mine.cookie);
    expect((await upload(item.id, other.cookie, await jpegWithGps())).status).toBe(404);
    expect((await upload(UNKNOWN_ID, mine.cookie, await jpegWithGps())).status).toBe(404);
    const none = await upload(item.id, mine.cookie, null);
    expect(none.status).toBe(400);
    expect(await none.json()).toEqual({ error: "invalid_upload" });
    const bad = await upload(item.id, mine.cookie, Buffer.from("not an image at all"));
    expect(bad.status).toBe(415);
    expect(await bad.json()).toEqual({ error: "unsupported_image" });
  });

  it("serves a private photo to its owner only", async () => {
    const mine = await t.signIn();
    const other = await t.signIn();
    const item = await newItem(mine.cookie);
    const photo = (await send(item.id, mine.cookie)).item.photos[0];
    expect((await call("GET", photo?.url ?? "", other.cookie)).status).toBe(404);
    expect((await call("GET", `/api/me/media/${UNKNOWN_ID}`, mine.cookie)).status).toBe(404);
    expect((await call("GET", "/api/me/media/not-a-uuid", mine.cookie)).status).toBe(404);
  });

  it("deletes a photo: rows and object gone; the cover goes back to the first shop photo", async () => {
    const { cookie } = await t.signIn();
    const item = await newItem(cookie, 1);
    const first = (await send(item.id, cookie)).item.photos[0];
    const second = (await send(item.id, cookie)).item.photos[1];
    const patch = await call("PATCH", `/api/me/items/${item.id}`, cookie, { coverMediaId: first?.id });
    expect(patch.status).toBe(200);
    const [row] = await t.db
      .select()
      .from(schema.media)
      .where(eq(schema.media.id, first?.id ?? ""));

    const res = await call("DELETE", `/api/me/items/${item.id}/media/${first?.id}`, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ItemResult;
    expect(body.undo).toBeNull();
    expect(body.item.coverMediaId).toBeNull();
    expect(body.item.photos.map((p) => p.id)).toContain(second?.id);
    expect(body.item.photos.some((p) => p.id === first?.id)).toBe(false);
    expect(body.item.coverUrl).toBe(body.item.photos.find((p) => p.source === "shop")?.url);
    expect(
      await t.db
        .select()
        .from(schema.media)
        .where(eq(schema.media.id, first?.id ?? "")),
    ).toHaveLength(0);
    await expect(t.store.get(row?.key ?? "")).rejects.toThrow();
    expect((await call("GET", first?.url ?? "", cookie)).status).toBe(404);
  });

  it("tolerates a stored object that is already missing, and refuses what is not hers or not on that item", async () => {
    const mine = await t.signIn();
    const other = await t.signIn();
    const item = await newItem(mine.cookie);
    const otherItem = await newItem(other.cookie);
    const photo = (await send(item.id, mine.cookie)).item.photos[0];
    const [row] = await t.db
      .select()
      .from(schema.media)
      .where(eq(schema.media.id, photo?.id ?? ""));
    await t.store.delete(row?.key ?? "");
    expect((await call("DELETE", `/api/me/items/${item.id}/media/${photo?.id}`, other.cookie)).status).toBe(404);
    expect((await call("DELETE", `/api/me/items/${otherItem.id}/media/${photo?.id}`, other.cookie)).status).toBe(404);
    expect((await call("DELETE", `/api/me/items/${item.id}/media/${UNKNOWN_ID}`, mine.cookie)).status).toBe(404);
    expect((await call("DELETE", `/api/me/items/${item.id}/media/${randomUUID()}x`, mine.cookie)).status).toBe(400);
    expect((await call("DELETE", `/api/me/items/${item.id}/media/${photo?.id}`, mine.cookie)).status).toBe(200);
  });

  it("orders photos by position, the next one after the last", async () => {
    const { cookie } = await t.signIn();
    const item = await newItem(cookie);
    await send(item.id, cookie);
    await send(item.id, cookie);
    const rows = await t.db
      .select()
      .from(schema.itemMedia)
      .where(eq(schema.itemMedia.itemId, item.id))
      .orderBy(asc(schema.itemMedia.position));
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
  });
});

describe("/api/me/items/:id/media/imports", () => {
  const importPath = (itemId: string, importId?: string) =>
    `/api/me/items/${itemId}/media/imports${importId ? `/${importId}` : ""}`;

  async function startImport(itemId: string, cookie: string, url = "https://shop.example/robe.jpg") {
    const res = await call("POST", importPath(itemId), cookie, { url });
    expect(res.status).toBe(202);
    return ((await res.json()) as { importId: string }).importId;
  }

  /** What the worker does on success: the object stored and the import `ready`. */
  async function simulateReady(importId: string, userId: string) {
    const image = await sharp({ create: { width: 320, height: 240, channels: 3, background: "#c04080" } })
      .webp()
      .toBuffer();
    const key = `users/${userId}/${randomUUID()}.webp`;
    await t.store.put(key, image, "image/webp");
    await t.db
      .update(schema.photoImports)
      .set({
        status: "ready",
        mediaKey: key,
        contentType: "image/webp",
        sizeBytes: image.length,
        width: 320,
        height: 240,
        updatedAt: new Date(),
      })
      .where(eq(schema.photoImports.id, importId));
    return key;
  }

  async function fillPhotos(itemId: string, userId: string, n: number) {
    for (let i = 0; i < n; i++) {
      const [media] = await t.db
        .insert(schema.media)
        .values({
          id: randomUUID(),
          userId,
          key: `users/${userId}/${randomUUID()}.webp`,
          contentType: "image/webp",
          sizeBytes: 1,
          width: 1,
          height: 1,
        })
        .returning();
      await t.db.insert(schema.itemMedia).values({ itemId, mediaId: media?.id as string, position: i });
    }
  }

  const exists = async (key: string) =>
    t.store.get(key).then(
      () => true,
      () => false,
    );

  it("answers 401 without a session", async () => {
    expect((await call("POST", importPath(UNKNOWN_ID), undefined, { url: "https://a.example/p.jpg" })).status).toBe(
      401,
    );
    expect((await call("GET", importPath(UNKNOWN_ID, UNKNOWN_ID), undefined)).status).toBe(401);
  });

  it("queues the import for the worker, then reads it as queued", async () => {
    const { cookie, userId } = await t.signIn();
    const item = await newItem(cookie);
    const before = t.calls.length;
    const importId = await startImport(item.id, cookie);
    expect(t.calls.slice(before)).toEqual([{ queue: "photo-import", id: importId }]);
    const [row] = await t.db.select().from(schema.photoImports).where(eq(schema.photoImports.id, importId));
    expect(row).toMatchObject({ userId, itemId: item.id, url: "https://shop.example/robe.jpg", status: "queued" });

    const res = await call("GET", importPath(item.id, importId), cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "queued" });
  });

  it("marks the import failed and answers 500 when the queue is down", async () => {
    const { cookie } = await t.signIn();
    const item = await newItem(cookie);
    const original = t.queue.enqueue;
    t.queue.enqueue = async () => {
      throw new Error("down");
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await call("POST", importPath(item.id), cookie, { url: "https://a.example/p.jpg" });
      expect(res.status).toBe(500);
    } finally {
      t.queue.enqueue = original;
      error.mockRestore();
    }
    const rows = await t.db.select().from(schema.photoImports).where(eq(schema.photoImports.itemId, item.id));
    expect(rows).toMatchObject([{ status: "failed", errorCode: "failed" }]);
  });

  it("refuses an address that is not http(s) or over 2 048 characters with 400", async () => {
    const { cookie } = await t.signIn();
    const item = await newItem(cookie);
    const before = t.calls.length;
    for (const url of [
      "ftp://shop.example/a.jpg",
      "javascript:alert(1)",
      "pas une adresse",
      "",
      `https://a.example/${"x".repeat(2040)}`,
    ]) {
      const res = await call("POST", importPath(item.id), cookie, { url });
      expect(res.status, url).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
    }
    expect((await call("POST", importPath(item.id), cookie, {})).status).toBe(400);
    expect(t.calls.length).toBe(before);
  });

  it("answers 404 for an unknown item or another account's item and import", async () => {
    const owner = await t.signIn();
    const other = await t.signIn();
    const item = await newItem(owner.cookie);
    const importId = await startImport(item.id, owner.cookie);
    expect((await call("POST", importPath(UNKNOWN_ID), owner.cookie, { url: "https://a.example/p.jpg" })).status).toBe(
      404,
    );
    expect((await call("POST", importPath(item.id), other.cookie, { url: "https://a.example/p.jpg" })).status).toBe(
      404,
    );
    const res = await call("GET", importPath(item.id, importId), other.cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect((await call("GET", importPath(item.id, UNKNOWN_ID), owner.cookie)).status).toBe(404);
    // The import belongs to that item only.
    const another = await newItem(owner.cookie);
    expect((await call("GET", importPath(another.id, importId), owner.cookie)).status).toBe(404);
  });

  it("refuses with 409 before queueing: 10 photos already, or an item in the trash", async () => {
    const { cookie, userId } = await t.signIn();
    const full = await newItem(cookie);
    await fillPhotos(full.id, userId, 10);
    const before = t.calls.length;
    const res = await call("POST", importPath(full.id), cookie, { url: "https://a.example/p.jpg" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "too_many_photos" });

    const trashed = await newItem(cookie);
    await t.db.update(schema.items).set({ deletedAt: new Date() }).where(eq(schema.items.id, trashed.id));
    const res2 = await call("POST", importPath(trashed.id), cookie, { url: "https://a.example/p.jpg" });
    expect(res2.status).toBe(409);
    expect(await res2.json()).toEqual({ error: "item_deleted" });
    expect(t.calls.length).toBe(before);
  });

  it("shows the worker's failure code", async () => {
    const { cookie } = await t.signIn();
    const item = await newItem(cookie);
    const importId = await startImport(item.id, cookie);
    await t.db
      .update(schema.photoImports)
      .set({ status: "failed", errorCode: "too_large", updatedAt: new Date() })
      .where(eq(schema.photoImports.id, importId));
    const res = await call("GET", importPath(item.id, importId), cookie);
    expect(await res.json()).toEqual({ status: "failed", error: "too_large" });
  });

  it("attaches a ready import on read: the item has one more photo, the import is attached", async () => {
    const { cookie, userId } = await t.signIn();
    const item = await newItem(cookie);
    await send(item.id, cookie);
    const importId = await startImport(item.id, cookie);
    const key = await simulateReady(importId, userId);

    const res = await call("GET", importPath(item.id, importId), cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; item: ItemView };
    expect(body.status).toBe("attached");
    expect(body.item.photos).toHaveLength(2);
    const added = body.item.photos[1];
    const [media] = await t.db
      .select()
      .from(schema.media)
      .where(eq(schema.media.id, added?.id ?? ""));
    expect(media).toMatchObject({ userId, key, contentType: "image/webp", width: 320, height: 240 });
    expect(await exists(key)).toBe(true);
    const [row] = await t.db.select().from(schema.photoImports).where(eq(schema.photoImports.id, importId));
    expect(row?.status).toBe("attached");
    expect(row?.updatedAt.getTime()).toBeGreaterThan(row?.createdAt.getTime() ?? 0);

    // Read again: still attached, no second photo.
    const again = (await (await call("GET", importPath(item.id, importId), cookie)).json()) as { item: ItemView };
    expect(again.item.photos).toHaveLength(2);
  });

  it("reading the item attaches its ready import, even when nobody polls the import", async () => {
    const { cookie, userId } = await t.signIn();
    const item = await newItem(cookie);
    const importId = await startImport(item.id, cookie);
    const key = await simulateReady(importId, userId);

    const res = await call("GET", `/api/me/items/${item.id}`, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ItemView;
    expect(body.photos).toHaveLength(1);
    const [media] = await t.db
      .select()
      .from(schema.media)
      .where(eq(schema.media.id, body.photos[0]?.id ?? ""));
    expect(media?.key).toBe(key);
    const [row] = await t.db.select().from(schema.photoImports).where(eq(schema.photoImports.id, importId));
    expect(row?.status).toBe("attached");

    // The poll that comes afterwards finds it attached, with the same single photo.
    const poll = (await (await call("GET", importPath(item.id, importId), cookie)).json()) as {
      status: string;
      item: ItemView;
    };
    expect(poll.status).toBe("attached");
    expect(poll.item.photos).toHaveLength(1);
    expect(await exists(key)).toBe(true);
  });

  it("reading the item of a product (the sheet's read) attaches its ready import", async () => {
    const { cookie, userId } = await t.signIn();
    const item = await newItem(cookie);
    const importId = await startImport(item.id, cookie);
    await simulateReady(importId, userId);

    const res = await call("GET", `/api/me/items?product=${item.product.id}`, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: ItemView[] };
    expect(body.items[0]?.photos).toHaveLength(1);
    const [row] = await t.db.select().from(schema.photoImports).where(eq(schema.photoImports.id, importId));
    expect(row?.status).toBe("attached");
  });

  it("reading the item while a poll attaches at the same time: one photo", async () => {
    const { cookie, userId } = await t.signIn();
    const item = await newItem(cookie);
    const importId = await startImport(item.id, cookie);
    const key = await simulateReady(importId, userId);
    const answers = await Promise.all([
      call("GET", `/api/me/items/${item.id}`, cookie),
      call("GET", importPath(item.id, importId), cookie),
      call("GET", `/api/me/items?product=${item.product.id}`, cookie),
    ]);
    for (const res of answers) expect(res.status).toBe(200);
    const photos = await t.db.select().from(schema.itemMedia).where(eq(schema.itemMedia.itemId, item.id));
    expect(photos).toHaveLength(1);
    expect(await exists(key)).toBe(true);
  });

  it("reading a full item fails its ready import and deletes the photo; the read still answers", async () => {
    const { cookie, userId } = await t.signIn();
    const item = await newItem(cookie);
    const importId = await startImport(item.id, cookie);
    await fillPhotos(item.id, userId, 10);
    const key = await simulateReady(importId, userId);
    const res = await call("GET", `/api/me/items/${item.id}`, cookie);
    expect(res.status).toBe(200);
    expect(((await res.json()) as ItemView).photos).toHaveLength(10);
    expect(await exists(key)).toBe(false);
    const [row] = await t.db.select().from(schema.photoImports).where(eq(schema.photoImports.id, importId));
    expect(row).toMatchObject({ status: "failed", mediaKey: null });
  });

  it("a failure while attaching on an item read keeps the import ready and still answers the item", async () => {
    const { cookie, userId } = await t.signIn();
    const item = await newItem(cookie);
    const importId = await startImport(item.id, cookie);
    const key = await simulateReady(importId, userId);
    await t.db.execute(
      sql`create function fail_item_media() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$`,
    );
    await t.db.execute(
      sql`create trigger fail_item_media before insert on item_media for each row execute function fail_item_media()`,
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await call("GET", `/api/me/items/${item.id}`, cookie);
      expect(res.status).toBe(200);
      expect(((await res.json()) as ItemView).photos).toHaveLength(0);
      expect(error).toHaveBeenCalled();
    } finally {
      await t.db.execute(sql`drop trigger fail_item_media on item_media`);
      await t.db.execute(sql`drop function fail_item_media()`);
      error.mockRestore();
    }
    const [row] = await t.db.select().from(schema.photoImports).where(eq(schema.photoImports.id, importId));
    expect(row).toMatchObject({ status: "ready", mediaKey: key });
    expect(await exists(key)).toBe(true);
  });

  it("a merge moves the imports of the merged item: its ready photo reaches the item that stays", async () => {
    const { cookie, userId } = await t.signIn();
    const trashed = await newItem(cookie);
    const importId = await startImport(trashed.id, cookie);
    const key = await simulateReady(importId, userId);
    // Into the trash, kept again (a new active item), then restored: merged into the active one.
    expect((await call("DELETE", `/api/me/items/${trashed.id}`, cookie)).status).toBe(200);
    const again = await call("POST", "/api/me/items", cookie, { productId: trashed.product.id, action: "wish" });
    const active = ((await again.json()) as ItemResult).item;
    expect(active.id).not.toBe(trashed.id);
    const restored = await call("POST", `/api/me/items/${trashed.id}/restore`, cookie);
    expect(restored.status).toBe(200);
    expect(((await restored.json()) as ItemResult).item.id).toBe(active.id);

    const [moved] = await t.db.select().from(schema.photoImports).where(eq(schema.photoImports.id, importId));
    expect(moved).toMatchObject({ itemId: active.id, status: "ready", mediaKey: key });
    expect(moved?.updatedAt.getTime()).toBeGreaterThan(moved?.createdAt.getTime() ?? 0);
    const read = (await (await call("GET", `/api/me/items/${active.id}`, cookie)).json()) as ItemView;
    expect(read.photos).toHaveLength(1);
    expect(await exists(key)).toBe(true);
  });

  it("attaches once when two reads arrive together", async () => {
    const { cookie, userId } = await t.signIn();
    const item = await newItem(cookie);
    const importId = await startImport(item.id, cookie);
    const key = await simulateReady(importId, userId);
    const answers = await Promise.all([
      call("GET", importPath(item.id, importId), cookie),
      call("GET", importPath(item.id, importId), cookie),
      call("GET", importPath(item.id, importId), cookie),
    ]);
    for (const res of answers) {
      expect(res.status).toBe(200);
      expect(((await res.json()) as { status: string }).status).toBe("attached");
    }
    const photos = await t.db.select().from(schema.itemMedia).where(eq(schema.itemMedia.itemId, item.id));
    expect(photos).toHaveLength(1);
    expect(await exists(key)).toBe(true);
  });

  it("a failure while attaching keeps the object and the import ready; the next read attaches it", async () => {
    const { cookie, userId } = await t.signIn();
    const item = await newItem(cookie);
    const importId = await startImport(item.id, cookie);
    const key = await simulateReady(importId, userId);
    await t.db.execute(
      sql`create function fail_item_media() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$`,
    );
    await t.db.execute(
      sql`create trigger fail_item_media before insert on item_media for each row execute function fail_item_media()`,
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await call("GET", importPath(item.id, importId), cookie)).status).toBe(500);
    } finally {
      await t.db.execute(sql`drop trigger fail_item_media on item_media`);
      await t.db.execute(sql`drop function fail_item_media()`);
      error.mockRestore();
    }
    expect(await exists(key)).toBe(true);
    const [row] = await t.db.select().from(schema.photoImports).where(eq(schema.photoImports.id, importId));
    expect(row).toMatchObject({ status: "ready", mediaKey: key });
    expect(await t.db.select().from(schema.media).where(eq(schema.media.key, key))).toEqual([]);

    const res = await call("GET", importPath(item.id, importId), cookie);
    const body = (await res.json()) as { status: string; item: ItemView };
    expect(body.status).toBe("attached");
    expect(body.item.photos).toHaveLength(1);
    expect(await exists(key)).toBe(true);
  });

  it("purging the trashed item deletes the object of a ready import", async () => {
    const { cookie, userId } = await t.signIn();
    const item = await newItem(cookie);
    const importId = await startImport(item.id, cookie);
    const key = await simulateReady(importId, userId);
    expect((await call("DELETE", `/api/me/items/${item.id}`, cookie)).status).toBe(200);
    expect((await call("DELETE", `/api/me/items/${item.id}/purge`, cookie)).status).toBe(204);
    expect(await exists(key)).toBe(false);
    expect(await t.db.select().from(schema.photoImports).where(eq(schema.photoImports.id, importId))).toEqual([]);
  });

  it("refused on read (10 photos meanwhile, item in the trash): failed with the reason, object deleted", async () => {
    const { cookie, userId } = await t.signIn();
    const full = await newItem(cookie);
    const fullImport = await startImport(full.id, cookie);
    await fillPhotos(full.id, userId, 10);
    const fullKey = await simulateReady(fullImport, userId);
    const res = await call("GET", importPath(full.id, fullImport), cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "failed", error: "too_many_photos" });
    expect(await exists(fullKey)).toBe(false);
    const media = await t.db.select().from(schema.media).where(eq(schema.media.key, fullKey));
    expect(media).toEqual([]);
    const [row] = await t.db.select().from(schema.photoImports).where(eq(schema.photoImports.id, fullImport));
    expect(row).toMatchObject({ status: "failed", mediaKey: null });

    const trashed = await newItem(cookie);
    const trashedImport = await startImport(trashed.id, cookie);
    const trashedKey = await simulateReady(trashedImport, userId);
    await t.db.update(schema.items).set({ deletedAt: new Date() }).where(eq(schema.items.id, trashed.id));
    const res2 = await call("GET", importPath(trashed.id, trashedImport), cookie);
    expect(await res2.json()).toEqual({ status: "failed", error: "item_deleted" });
    expect(await exists(trashedKey)).toBe(false);
  });
});
