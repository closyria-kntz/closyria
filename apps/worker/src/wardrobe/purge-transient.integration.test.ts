import { createDb, eq, schema } from "@closyria/db";
import { memoryStore, type ObjectStore } from "@closyria/storage";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { purgeTransient } from "./purge-transient";

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

const now = new Date("2026-11-05T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

async function setup() {
  const { db } = handle;
  const n = ++counter;
  const userId = `transient-user-${n}`;
  await db.insert(schema.user).values({ id: userId, name: userId, email: `${userId}@example.test` });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ userId, name: "Moi", audience: "women", color: "plum" })
    .returning();
  const [item] = await db
    .insert(schema.items)
    .values({ userId, profileId: profile?.id as string })
    .returning();
  const [shop] = await db
    .insert(schema.shops)
    .values({ name: `S${n}`, slug: `transient-shop-${n}` })
    .returning();
  const product = async () => {
    const [p] = await db
      .insert(schema.products)
      .values({ shopId: shop?.id as string, canonicalUrl: `https://t-${n}-${++counter}.test/p`, name: "Robe" })
      .returning();
    return p?.id as string;
  };
  return { userId, itemId: item?.id as string, product };
}

const stored = async (store: ObjectStore, key: string) => {
  try {
    await store.get(key);
    return true;
  } catch {
    return false;
  }
};

describe("purgeTransient", () => {
  it("deletes recents last visited over 90 days ago, keeps 89 days", async () => {
    const { db } = handle;
    const ctx = await setup();
    const old = await ctx.product();
    const fresh = await ctx.product();
    await db.insert(schema.recentProducts).values([
      { userId: ctx.userId, productId: old, visitedAt: daysAgo(91) },
      { userId: ctx.userId, productId: fresh, visitedAt: daysAgo(89) },
    ]);
    expect(await purgeTransient(db, now, memoryStore())).toEqual({ recents: 1, imports: 0 });
    const rows = await db.select().from(schema.recentProducts).where(eq(schema.recentProducts.userId, ctx.userId));
    expect(rows.map((r) => r.productId)).toEqual([fresh]);
  });

  it("deletes ready imports over 24 h with their object, attached ones without touching it", async () => {
    const { db } = handle;
    const store = memoryStore();
    const ctx = await setup();
    await store.put("imports/ready-old", Buffer.from("x"), "image/webp");
    await store.put("imports/ready-new", Buffer.from("x"), "image/webp");
    await store.put("users/attached-old", Buffer.from("x"), "image/webp");
    const base = { userId: ctx.userId, itemId: ctx.itemId, url: "https://example.test/a.jpg" };
    await db.insert(schema.photoImports).values([
      { ...base, status: "ready", mediaKey: "imports/ready-old", createdAt: hoursAgo(25) },
      { ...base, status: "ready", mediaKey: "imports/ready-new", createdAt: hoursAgo(23) },
      { ...base, status: "attached", mediaKey: "users/attached-old", createdAt: hoursAgo(25) },
      { ...base, status: "failed", errorCode: "timeout", createdAt: hoursAgo(30) },
    ]);
    expect((await purgeTransient(db, now, store)).imports).toBe(3);
    expect(await stored(store, "imports/ready-old")).toBe(false);
    expect(await stored(store, "imports/ready-new")).toBe(true);
    expect(await stored(store, "users/attached-old")).toBe(true);
    expect(await db.select().from(schema.photoImports).where(eq(schema.photoImports.userId, ctx.userId))).toHaveLength(
      1,
    );
  });
});
