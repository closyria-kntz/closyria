import { and, createDb, eq, schema } from "@closyria/db";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectShopPromo } from "./promo";
import { detectSalePeriods } from "./sales";

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

const runStartedAt = new Date("2026-11-14T13:00:00Z");
const at = new Date("2026-11-14T13:30:00Z");
const before = new Date("2026-11-13T13:00:00Z");
const days = (base: Date, n: number) => new Date(base.getTime() + n * 86_400_000);

async function person() {
  const { db } = handle;
  const userId = `promo-user-${++counter}`;
  await db.insert(schema.user).values({ id: userId, name: userId, email: `${userId}@example.test` });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ userId, name: "Moi", audience: "women", color: "plum" })
    .returning();
  if (!profile) throw new Error("no profile");
  return { userId, profileId: profile.id };
}

async function shop() {
  const n = ++counter;
  const [row] = await handle.db
    .insert(schema.shops)
    .values({ name: `Promo ${n}`, slug: `promo-${n}`, platform: "shopify", status: "published" })
    .returning();
  if (!row) throw new Error("no shop");
  return row.id;
}

/**
 * A shop with `total` visible products: `dropped` of them with a real drop during the run, the others unchanged;
 * `hidden` more products, hidden or removed, all dropped (they never count).
 */
async function shopWith(total: number, dropped: number, options: { hidden?: number; smallDrop?: number } = {}) {
  const { db } = handle;
  const shopId = await shop();
  const products: string[] = [];
  const add = async (values: Partial<typeof schema.products.$inferInsert>, oldPrice: number, newPrice?: number) => {
    const [row] = await db
      .insert(schema.products)
      .values({ shopId, canonicalUrl: `https://promo-${++counter}.example/p`, name: "Robe", ...values })
      .returning();
    if (!row) throw new Error("no product");
    await db
      .insert(schema.productHistory)
      .values({ productId: row.id, seenAt: before, priceCents: oldPrice, sizes: {} });
    if (newPrice !== undefined) {
      await db.insert(schema.productHistory).values({
        productId: row.id,
        seenAt: new Date(runStartedAt.getTime() + 60_000),
        priceCents: newPrice,
        sizes: {},
      });
    }
    products.push(row.id);
    return row.id;
  };
  for (let i = 0; i < total; i++) await add({}, 10000, i < dropped ? 8000 : undefined);
  for (let i = 0; i < (options.smallDrop ?? 0); i++) await add({}, 10000, 9900);
  for (let i = 0; i < (options.hidden ?? 0); i++) {
    await add(i % 2 === 0 ? { hiddenAt: before } : { removedAt: before }, 10000, 5000);
  }
  return { shopId, products };
}

const followerOf = async (productId: string, values: Partial<typeof schema.items.$inferInsert> = {}) => {
  const owner = await person();
  await handle.db
    .insert(schema.items)
    .values({ userId: owner.userId, profileId: owner.profileId, productId, ...values });
  return owner;
};

const eventsOf = (userId: string) =>
  handle.db.select().from(schema.alertEvents).where(eq(schema.alertEvents.userId, userId));

describe("detectShopPromo", () => {
  it("≥ 5 visible and ≥ 30 % with a real drop: one shop_promo per follower of the shop, for the day's digest", async () => {
    const { shopId, products } = await shopWith(10, 3);
    const a = await followerOf(products[9] ?? "");
    const b = await followerOf(products[0] ?? "");
    // Two wishes of the same shop: still one event.
    await handle.db.insert(schema.items).values({ userId: b.userId, profileId: b.profileId, productId: products[5] });
    const ordered = await followerOf(products[1] ?? "", { stage: "ordered" });
    const off = await followerOf(products[2] ?? "", { alertsEnabled: false });
    const trashed = await followerOf(products[3] ?? "", { deletedAt: before });

    expect(await detectShopPromo(handle.db, shopId, runStartedAt, at)).toBe(2);
    for (const who of [a, b]) {
      const events = await eventsOf(who.userId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: "shop_promo",
        shopId,
        itemId: null,
        digestOn: "2026-11-14",
        status: "pending",
      });
    }
    for (const who of [ordered, off, trashed]) expect(await eventsOf(who.userId)).toHaveLength(0);
  });

  it("under 30 %, small drops, or hidden / removed products: no promo", async () => {
    // 2 real drops out of 7 visible (28 %); the small drops and the hidden ones do not count.
    const { shopId, products } = await shopWith(5, 2, { smallDrop: 2, hidden: 4 });
    const a = await followerOf(products[0] ?? "");
    expect(await detectShopPromo(handle.db, shopId, runStartedAt, at)).toBe(0);
    expect(await eventsOf(a.userId)).toHaveLength(0);
  });

  it("fewer than 5 visible products: no promo, whatever the share", async () => {
    const { shopId, products } = await shopWith(4, 4);
    const a = await followerOf(products[0] ?? "");
    expect(await detectShopPromo(handle.db, shopId, runStartedAt, at)).toBe(0);
    expect(await eventsOf(a.userId)).toHaveLength(0);
  });

  it("drops before the run do not count", async () => {
    const { shopId, products } = await shopWith(5, 0);
    for (const id of products.slice(0, 3)) {
      await handle.db
        .insert(schema.productHistory)
        .values({ productId: id, seenAt: new Date(runStartedAt.getTime() - 60_000), priceCents: 5000, sizes: {} });
    }
    const a = await followerOf(products[0] ?? "");
    expect(await detectShopPromo(handle.db, shopId, runStartedAt, at)).toBe(0);
    expect(await eventsOf(a.userId)).toHaveLength(0);
  });

  it("at most one per shop and person every 7 days", async () => {
    const { shopId, products } = await shopWith(5, 5);
    const a = await followerOf(products[0] ?? "");
    expect(await detectShopPromo(handle.db, shopId, runStartedAt, at)).toBe(1);
    expect(await detectShopPromo(handle.db, shopId, days(runStartedAt, 6), days(at, 6))).toBe(0);
    expect(await eventsOf(a.userId)).toHaveLength(1);
  });

  it("a guest without an account gets it too", async () => {
    const { shopId, products } = await shopWith(5, 5);
    const a = await followerOf(products[0] ?? "");
    await handle.db.update(schema.user).set({ isAnonymous: true }).where(eq(schema.user.id, a.userId));
    expect(await detectShopPromo(handle.db, shopId, runStartedAt, at)).toBe(1);
  });
});

describe("detectSalePeriods", () => {
  async function period(startsOn: string, endsOn: string) {
    const [row] = await handle.db
      .insert(schema.salePeriods)
      .values({ name: `Soldes ${++counter}`, startsOn, endsOn })
      .returning();
    if (!row) throw new Error("no period");
    return row.id;
  }

  it("2 days before the start and on the start day: one sale_period per person with a followed wish", async () => {
    const shopId = await shop();
    const [p] = await handle.db
      .insert(schema.products)
      .values({ shopId, canonicalUrl: `https://sales-${++counter}.example/p`, name: "Robe" })
      .returning();
    if (!p) throw new Error("no product");
    const follower = await followerOf(p.id);
    const ordered = await followerOf(p.id, { stage: "ordered" });
    const off = await followerOf(p.id, { alertsEnabled: false });
    // A wish without a product (a photo) follows nothing.
    const photoOnly = await person();
    await handle.db.insert(schema.items).values({ userId: photoOnly.userId, profileId: photoOnly.profileId });

    // Wednesday 2027-01-13: noted on Monday the 11th and on the day.
    const salesId = await period("2027-01-13", "2027-02-09");
    const recipients = async (when: Date) => {
      await detectSalePeriods(handle.db, when);
      return (await eventsOf(follower.userId))
        .filter((e) => e.salePeriodId === salesId)
        .sort((x, y) => String(x.digestOn).localeCompare(String(y.digestOn)));
    };

    expect(await recipients(new Date("2027-01-10T08:00:00Z"))).toHaveLength(0);
    expect(await recipients(new Date("2027-01-11T06:00:00Z"))).toHaveLength(1);
    // A second run the same day adds nothing.
    expect(await recipients(new Date("2027-01-11T12:00:00Z"))).toHaveLength(1);
    expect(await recipients(new Date("2027-01-12T06:00:00Z"))).toHaveLength(1);
    const onTheDay = await recipients(new Date("2027-01-13T06:00:00Z"));
    expect(onTheDay.map((e) => [e.kind, e.digestOn, e.itemId, e.status])).toEqual([
      ["sale_period", "2027-01-11", null, "pending"],
      ["sale_period", "2027-01-13", null, "pending"],
    ]);
    expect(await recipients(new Date("2027-01-14T06:00:00Z"))).toHaveLength(2);
    for (const who of [ordered, off, photoOnly]) {
      const sales = await handle.db
        .select()
        .from(schema.alertEvents)
        .where(and(eq(schema.alertEvents.userId, who.userId), eq(schema.alertEvents.salePeriodId, salesId)));
      expect(sales).toHaveLength(0);
    }
  });
});
