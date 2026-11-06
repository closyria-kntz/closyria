import { randomUUID } from "node:crypto";
import { asc, eq, schema } from "@closyria/db";
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
  const res = await call("POST", "/api/me/items", cookie, { productId: product.id, action: "favorite" });
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
