import { createDb, eq, schema } from "@closyria/db";
import type { ExtractedProduct } from "@closyria/shared";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeProduct } from "../capture/write-product";
import { detectAlerts, type HistoryPoint } from "./detect";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let handle: ReturnType<typeof createDb>;
let counter = 0;

beforeAll(async () => {
  database = await createTestDatabase();
  handle = createDb(database.url, { max: 4 });
}, 60_000);

afterAll(async () => {
  await handle?.pool.end();
  await database?.stop();
});

// 14:00 in Paris (winter): immediate alerts go out at once.
const at = new Date("2026-11-14T13:00:00Z");
const minutes = (base: Date, n: number) => new Date(base.getTime() + n * 60_000);

async function category(slug: string, parentSlug?: string): Promise<string> {
  const { db } = handle;
  const [found] = await db.select().from(schema.categories).where(eq(schema.categories.slug, slug));
  if (found) return found.id;
  const parentId = parentSlug ? await category(parentSlug) : undefined;
  const [row] = await db
    .insert(schema.categories)
    .values({ slug, name: slug, ...(parentId ? { parentId } : {}) })
    .returning();
  if (!row) throw new Error("no category");
  return row.id;
}

async function person(sizes: { top?: string[]; bottom?: string[]; shoes?: string[] } = {}) {
  const { db } = handle;
  const n = ++counter;
  const userId = `detect-user-${n}`;
  await db.insert(schema.user).values({ id: userId, name: userId, email: `${userId}@example.test` });
  const [profile] = await db
    .insert(schema.profiles)
    .values({
      userId,
      name: "Moi",
      audience: "women",
      color: "plum",
      sizesTop: sizes.top ?? [],
      sizesBottom: sizes.bottom ?? [],
      sizesShoes: sizes.shoes ?? [],
    })
    .returning();
  if (!profile) throw new Error("no profile");
  return { userId, profileId: profile.id };
}

async function product(values: Partial<typeof schema.products.$inferInsert> = {}) {
  const { db } = handle;
  const n = ++counter;
  const [shop] = await db
    .insert(schema.shops)
    .values({ name: `Detect ${n}`, slug: `detect-${n}`, platform: "shopify", status: "published" })
    .returning();
  if (!shop) throw new Error("no shop");
  const [row] = await db
    .insert(schema.products)
    .values({ shopId: shop.id, canonicalUrl: `https://detect-${n}.example/p`, name: "Robe Iris", ...values })
    .returning();
  if (!row) throw new Error("no product");
  return row.id;
}

async function wish(
  owner: { userId: string; profileId: string },
  productId: string,
  values: Partial<typeof schema.items.$inferInsert> = {},
) {
  const [item] = await handle.db
    .insert(schema.items)
    .values({ userId: owner.userId, profileId: owner.profileId, productId, ...values })
    .returning();
  if (!item) throw new Error("no item");
  return item.id;
}

const events = (userId: string) =>
  handle.db.select().from(schema.alertEvents).where(eq(schema.alertEvents.userId, userId));

const detect = (productId: string, previous: HistoryPoint | null, next: HistoryPoint, when = at) =>
  handle.db.transaction((tx) => detectAlerts(tx, productId, previous, next, when));

const point = (priceCents: number | null, sizes: Record<string, boolean> = {}): HistoryPoint => ({ priceCents, sizes });

describe("detectAlerts", () => {
  it("size back on the item's own size: one size_back, immediate", async () => {
    const owner = await person({ top: ["S"] });
    const productId = await product();
    const itemId = await wish(owner, productId, { sizeLabel: "M" });

    const created = await detect(productId, point(8000, { M: false, S: false }), point(8000, { M: true, S: false }));

    expect(created).toBe(1);
    const [event] = await events(owner.userId);
    expect(event).toMatchObject({
      kind: "size_back",
      itemId,
      profileId: owner.profileId,
      productId,
      sizeLabel: "M",
      status: "pending",
      digestOn: null,
    });
    expect(event?.sendAfter?.toISOString()).toBe(at.toISOString());
  });

  it("without a size on the item: the sizes of the item's profile for its kind (« 38 FR » matches « 38 »)", async () => {
    const owner = await person({ top: ["38"], bottom: ["42"] });
    const robes = await category("robes");
    const child = await category(`robe-test-${++counter}`, "robes");
    const productId = await product({ categoryId: robes });
    await wish(owner, productId, { categoryId: child });

    // Its bottom size (42) is not watched on a dress.
    expect(await detect(productId, point(8000, { "42 FR": false }), point(8000, { "42 FR": true }))).toBe(0);
    expect(await detect(productId, point(8000, { "38 FR": false }), point(8000, { "38 FR": true }))).toBe(1);
    expect((await events(owner.userId)).map((e) => e.sizeLabel)).toEqual(["38 FR"]);
  });

  it("the sizes are those of the item's profile, not another of her profiles", async () => {
    const owner = await person({ top: ["S"] });
    const [other] = await handle.db
      .insert(schema.profiles)
      .values({ userId: owner.userId, name: "Léa", audience: "child", color: "sage", sizesTop: ["10 ans"] })
      .returning();
    if (!other) throw new Error("no profile");
    const productId = await product({ categoryId: await category("robes") });
    await wish({ userId: owner.userId, profileId: other.id }, productId);

    expect(await detect(productId, point(5000, { S: false }), point(5000, { S: true }))).toBe(0);
    expect(await detect(productId, point(5000, { "10 ans": false }), point(5000, { "10 ans": true }))).toBe(1);
    const [event] = await events(owner.userId);
    expect(event?.profileId).toBe(other.id);
  });

  it("no size anywhere: back in stock at all (« any »)", async () => {
    const owner = await person();
    const productId = await product();
    await wish(owner, productId);

    expect(await detect(productId, point(3000, { TU: false }), point(3000, { TU: true }))).toBe(1);
    expect((await events(owner.userId))[0]?.sizeLabel).toBe("TU");
  });

  it("a watched size still in stock before: nothing", async () => {
    const owner = await person();
    const productId = await product();
    await wish(owner, productId, { sizeLabel: "M" });

    expect(await detect(productId, point(8000, { M: true }), point(8000, { M: true, L: true }))).toBe(0);
  });

  it("price reaches the target from above: target_price, immediate, and no price_drop for the same fall", async () => {
    const owner = await person();
    const productId = await product();
    const itemId = await wish(owner, productId, { targetPriceCents: 6000 });

    expect(await detect(productId, point(8000), point(5900))).toBe(1);
    const [event] = await events(owner.userId);
    expect(event).toMatchObject({ kind: "target_price", itemId, priceCents: 5900, previousCents: 8000 });
    expect(event?.sendAfter?.toISOString()).toBe(at.toISOString());
    // Already under the target: no second alert until the price goes back over it.
    expect(await detect(productId, point(5900), point(5000))).toBe(1);
    expect((await events(owner.userId)).map((e) => e.kind).sort()).toEqual(["price_drop", "target_price"]);
    expect(await detect(productId, point(5000), point(6500), minutes(at, 1))).toBe(0);
    expect(await detect(productId, point(6500), point(6000), minutes(at, 2))).toBe(1);
    expect((await events(owner.userId)).filter((e) => e.kind === "target_price")).toHaveLength(2);
  });

  it("a real drop: price_drop for the Paris day's digest; a small one: nothing", async () => {
    const owner = await person();
    const productId = await product();
    const itemId = await wish(owner, productId);

    expect(await detect(productId, point(10000), point(9600))).toBe(0);
    // 23:30 in Paris on the 14th is still the 14th; 00:30 is the 15th.
    expect(await detect(productId, point(10000), point(9500), new Date("2026-11-14T22:30:00Z"))).toBe(1);
    expect(await detect(productId, point(9500), point(8000), new Date("2026-11-14T23:30:00Z"))).toBe(1);
    const drops = await events(owner.userId);
    expect(drops.map((e) => [e.kind, e.itemId, e.priceCents, e.previousCents, e.digestOn, e.sendAfter])).toEqual(
      expect.arrayContaining([
        ["price_drop", itemId, 9500, 10000, "2026-11-14", null],
        ["price_drop", itemId, 8000, 9500, "2026-11-15", null],
      ]),
    );
  });

  it("night: an immediate alert waits for 8:00 Paris", async () => {
    const owner = await person();
    const productId = await product();
    await wish(owner, productId, { sizeLabel: "M" });

    await detect(productId, point(8000, { M: false }), point(8000, { M: true }), new Date("2026-11-14T22:30:00Z"));
    const [event] = await events(owner.userId);
    expect(event?.sendAfter?.toISOString()).toBe("2026-11-15T07:00:00.000Z");
  });

  it("no previous point (first capture or first write): nothing at all", async () => {
    const owner = await person();
    const productId = await product();
    await wish(owner, productId, { sizeLabel: "M", targetPriceCents: 9000 });

    expect(await detect(productId, null, point(1000, { M: true }))).toBe(0);
    expect(await events(owner.userId)).toHaveLength(0);
  });

  it("null prices: no price alert, sizes still compared", async () => {
    const owner = await person();
    const productId = await product();
    await wish(owner, productId, { sizeLabel: "M", targetPriceCents: 9000 });

    expect(await detect(productId, point(null, { M: false }), point(5000, { M: false }))).toBe(0);
    expect(await detect(productId, point(10000, { M: false }), point(null, { M: true }))).toBe(1);
    expect((await events(owner.userId)).map((e) => e.kind)).toEqual(["size_back"]);
  });

  it("nothing changes: no event (Review Focus 1)", async () => {
    const owner = await person();
    const productId = await product();
    await wish(owner, productId, { sizeLabel: "M", targetPriceCents: 5000 });

    expect(await detect(productId, point(4000, { M: true, L: false }), point(4000, { L: false, M: true }))).toBe(0);
    expect(await events(owner.userId)).toHaveLength(0);
  });

  it("a size that blinks within 10 minutes: one size_back per 24 h (Review Focus 2)", async () => {
    const owner = await person();
    const productId = await product();
    await wish(owner, productId, { sizeLabel: "M" });

    const out = point(8000, { M: false });
    const back = point(8000, { M: true });
    expect(await detect(productId, out, back, at)).toBe(1);
    expect(await detect(productId, back, out, minutes(at, 5))).toBe(0);
    expect(await detect(productId, out, back, minutes(at, 10))).toBe(0);
    expect(await events(owner.userId)).toHaveLength(1);
    // A day later it counts again.
    expect(await detect(productId, back, out, minutes(at, 24 * 60 + 5))).toBe(0);
    expect(await detect(productId, out, back, minutes(at, 24 * 60 + 10))).toBe(1);
  });

  it("ordered, deleted, alerts off, or no longer hers: nothing (Review Focus 5)", async () => {
    const owner = await person();
    const productId = await product();
    await wish(owner, productId, { stage: "ordered" });
    const other = await person();
    await wish(other, productId, { deletedAt: at });
    const third = await person();
    await wish(third, productId, { alertsEnabled: false });

    expect(await detect(productId, point(8000, { M: false }), point(4000, { M: true }))).toBe(0);
    for (const who of [owner, other, third]) expect(await events(who.userId)).toHaveLength(0);
  });

  it("moved to another of her profiles, or to someone else: the event follows the item's current profile and owner", async () => {
    const owner = await person();
    const [other] = await handle.db
      .insert(schema.profiles)
      .values({ userId: owner.userId, name: "Léa", audience: "child", color: "sage" })
      .returning();
    if (!other) throw new Error("no profile");
    const productId = await product();
    const itemId = await wish(owner, productId);

    await handle.db.update(schema.items).set({ profileId: other.id }).where(eq(schema.items.id, itemId));
    expect(await detect(productId, point(10000), point(8000))).toBe(1);
    expect((await events(owner.userId)).map((e) => [e.itemId, e.profileId])).toEqual([[itemId, other.id]]);

    // Given to someone else (her profile with it): only the new owner hears of it.
    const heir = await person();
    await handle.db
      .update(schema.items)
      .set({ userId: heir.userId, profileId: heir.profileId })
      .where(eq(schema.items.id, itemId));
    expect(await detect(productId, point(8000), point(6000), minutes(at, 1))).toBe(1);
    expect(await events(owner.userId)).toHaveLength(1);
    expect((await events(heir.userId)).map((e) => [e.itemId, e.profileId])).toEqual([[itemId, heir.profileId]]);

    // An item pointing at a profile that is not its owner's: never anyone's alert.
    await handle.db.update(schema.items).set({ profileId: other.id }).where(eq(schema.items.id, itemId));
    expect(await detect(productId, point(6000), point(4000), minutes(at, 2))).toBe(0);
    expect(await events(owner.userId)).toHaveLength(1);
    expect(await events(heir.userId)).toHaveLength(1);
  });

  it("her settings: size_back / target_price off → none of that kind; digest off still records drops", async () => {
    const owner = await person();
    await handle.db
      .insert(schema.alertSettings)
      .values({ userId: owner.userId, sizeBack: false, targetPrice: false, digest: false });
    const productId = await product();
    await wish(owner, productId, { sizeLabel: "M", targetPriceCents: 6000 });

    expect(await detect(productId, point(8000, { M: false }), point(5000, { M: true }))).toBe(1);
    expect((await events(owner.userId)).map((e) => e.kind)).toEqual(["price_drop"]);
  });

  it("a guest without an account gets events too", async () => {
    const owner = await person();
    await handle.db.update(schema.user).set({ isAnonymous: true }).where(eq(schema.user.id, owner.userId));
    const productId = await product();
    await wish(owner, productId, { sizeLabel: "M" });

    expect(await detect(productId, point(8000, { M: false }), point(8000, { M: true }))).toBe(1);
  });

  it("each event goes to the item's owner only, one per follower", async () => {
    const a = await person();
    const b = await person();
    const productId = await product();
    const itemA = await wish(a, productId);
    const itemB = await wish(b, productId);
    const stranger = await person();

    expect(await detect(productId, point(10000), point(8000))).toBe(2);
    expect((await events(a.userId)).map((e) => [e.itemId, e.profileId])).toEqual([[itemA, a.profileId]]);
    expect((await events(b.userId)).map((e) => [e.itemId, e.profileId])).toEqual([[itemB, b.profileId]]);
    expect(await events(stranger.userId)).toHaveLength(0);
  });
});

const extracted = (priceCents: number, sizes: Record<string, boolean>): ExtractedProduct => ({
  name: "Robe Iris",
  currency: "EUR",
  priceCents,
  images: [],
  sizes: Object.entries(sizes).map(([label, available]) => ({ label, available })),
  platform: "shopify",
});

describe("writeProduct → detectAlerts", () => {
  const write = (productId: string, p: ExtractedProduct, when: Date, history: "always" | "on_change") =>
    handle.db.transaction((tx) =>
      writeProduct(tx, {
        productId,
        product: p,
        url: "https://detect.example/p",
        listingKind: "catalog",
        reference: undefined,
        at: when,
        history,
      }),
    );

  it("first write: no alert; a size back on the next import: size_back; an unchanged rewrite: none", async () => {
    const owner = await person();
    const productId = await product();
    await wish(owner, productId, { sizeLabel: "M" });

    await write(productId, extracted(8000, { M: true }), at, "on_change");
    expect(await events(owner.userId)).toHaveLength(0);
    await write(productId, extracted(8000, { M: false }), minutes(at, 60), "on_change");
    await write(productId, extracted(8000, { M: true }), minutes(at, 120), "on_change");
    expect((await events(owner.userId)).map((e) => e.kind)).toEqual(["size_back"]);

    // The hourly import rewrites it unchanged, and her capture writes history every time: no new event.
    await write(productId, extracted(8000, { M: true }), minutes(at, 180), "on_change");
    await write(productId, extracted(8000, { M: true }), minutes(at, 240), "always");
    expect(await events(owner.userId)).toHaveLength(1);
  });

  it("a real drop between two writes: price_drop with the previous history price", async () => {
    const owner = await person();
    const productId = await product();
    await wish(owner, productId);

    await write(productId, extracted(10000, {}), at, "always");
    await write(productId, extracted(9000, {}), minutes(at, 30), "on_change");
    const [event] = await events(owner.userId);
    expect(event).toMatchObject({ kind: "price_drop", priceCents: 9000, previousCents: 10000 });
  });
});
