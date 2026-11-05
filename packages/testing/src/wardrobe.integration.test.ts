import { createDb, eq, schema } from "@closyria/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "./postgres";
import { createTestDatabase } from "./vitest";

let database: TestDatabase;
let handle: ReturnType<typeof createDb>;
let counter = 0;

beforeAll(async () => {
  database = await createTestDatabase();
  handle = createDb(database.url, { max: 3 });
}, 60_000);

afterAll(async () => {
  await handle?.pool.end();
  await database?.stop();
});

async function newUser() {
  const n = ++counter;
  const [u] = await handle.db
    .insert(schema.user)
    .values({ id: `u${n}`, name: `U${n}`, email: `u${n}@test.local`, emailVerified: true })
    .returning();
  if (!u) throw new Error("no user");
  return u;
}

async function newProduct() {
  const n = ++counter;
  const [shop] = await handle.db
    .insert(schema.shops)
    .values({ name: `Shop ${n}`, slug: `wshop-${n}` })
    .returning();
  if (!shop) throw new Error("no shop");
  const [product] = await handle.db
    .insert(schema.products)
    .values({ shopId: shop.id, canonicalUrl: `https://shop.test/w/${n}`, name: "Robe", currency: "EUR" })
    .returning();
  if (!product) throw new Error("no product");
  return product;
}

async function newProfile(userId: string, overrides: Partial<typeof schema.profiles.$inferInsert> = {}) {
  const [p] = await handle.db
    .insert(schema.profiles)
    .values({ userId, name: "Moi", audience: "women", color: "plum", ...overrides })
    .returning();
  if (!p) throw new Error("no profile");
  return p;
}

async function newItem(
  userId: string,
  profileId: string,
  productId: string,
  overrides: Partial<typeof schema.items.$inferInsert> = {},
) {
  const [i] = await handle.db
    .insert(schema.items)
    .values({ userId, profileId, productId, ...overrides })
    .returning();
  if (!i) throw new Error("no item");
  return i;
}

describe("wardrobe tables", () => {
  it("applies defaults and refuses stage 'gone'", async () => {
    const u = await newUser();
    const profile = await newProfile(u.id);
    const product = await newProduct();
    const item = await newItem(u.id, profile.id, product.id);
    expect(item.stage).toBe("spotted");
    expect(item.favorite).toBe(false);
    expect(item.deletedAt).toBeNull();
    const p2 = await newProduct();
    await expect(newItem(u.id, profile.id, p2.id, { stage: "gone" as never })).rejects.toThrow();
  });

  it("refuses bad enumerations and overlong values", async () => {
    const u = await newUser();
    await expect(newProfile(u.id, { audience: "other" as never })).rejects.toThrow();
    await expect(newProfile(u.id, { childDetail: "x" as never })).rejects.toThrow();
    await expect(newProfile(u.id, { name: "" })).rejects.toThrow();
    await expect(newProfile(u.id, { name: "x".repeat(41) })).rejects.toThrow();
    const profile = await newProfile(u.id);
    const product = await newProduct();
    await expect(newItem(u.id, profile.id, product.id, { sizeLabel: "x".repeat(41) })).rejects.toThrow();
    await expect(newItem(u.id, profile.id, product.id, { notes: "x".repeat(2001) })).rejects.toThrow();
    await expect(handle.db.insert(schema.wishlists).values({ userId: u.id, name: "x".repeat(81) })).rejects.toThrow();
    await expect(handle.db.insert(schema.tags).values({ userId: u.id, name: "" })).rejects.toThrow();
  });

  it("allows one active item per product, but a deleted one next to an active one", async () => {
    const u = await newUser();
    const profile = await newProfile(u.id);
    const product = await newProduct();
    const first = await newItem(u.id, profile.id, product.id);
    await expect(newItem(u.id, profile.id, product.id)).rejects.toThrow();
    await handle.db.update(schema.items).set({ deletedAt: new Date() }).where(eq(schema.items.id, first.id));
    await newItem(u.id, profile.id, product.id);
    await handle.db.update(schema.items).set({ deletedAt: new Date() }).where(eq(schema.items.userId, u.id));
    await newItem(u.id, profile.id, product.id);
  });

  it("makes tag names unique per user, case-insensitively", async () => {
    const a = await newUser();
    const b = await newUser();
    await handle.db.insert(schema.tags).values({ userId: a.id, name: "Été" });
    await expect(handle.db.insert(schema.tags).values({ userId: a.id, name: "été" })).rejects.toThrow();
    await handle.db.insert(schema.tags).values({ userId: b.id, name: "Été" });
  });

  it("refuses to delete a profile that has an item", async () => {
    const u = await newUser();
    const profile = await newProfile(u.id);
    await newItem(u.id, profile.id, (await newProduct()).id);
    await expect(handle.db.delete(schema.profiles).where(eq(schema.profiles.id, profile.id))).rejects.toThrow();
  });

  it("deletes everything with the user", async () => {
    const u = await newUser();
    const profile = await newProfile(u.id);
    const product = await newProduct();
    const item = await newItem(u.id, profile.id, product.id);
    await handle.db.insert(schema.itemEvents).values({ itemId: item.id, type: "stage", stage: "owned" });
    await expect(
      handle.db.insert(schema.itemEvents).values({ itemId: item.id, type: "gone" as never }),
    ).rejects.toThrow();
    const [list] = await handle.db.insert(schema.wishlists).values({ userId: u.id, name: "Envies" }).returning();
    const [tag] = await handle.db.insert(schema.tags).values({ userId: u.id, name: "Soirée" }).returning();
    if (!list || !tag) throw new Error("no list/tag");
    await handle.db.insert(schema.wishlistItems).values({ wishlistId: list.id, itemId: item.id });
    await handle.db.insert(schema.itemTags).values({ itemId: item.id, tagId: tag.id });
    const mediaId = crypto.randomUUID();
    await handle.db.insert(schema.media).values({
      id: mediaId,
      userId: u.id,
      key: `users/${u.id}/${mediaId}.webp`,
      contentType: "image/webp",
      sizeBytes: 10,
      width: 3,
      height: 4,
    });
    await handle.db.insert(schema.itemMedia).values({ itemId: item.id, mediaId, position: 0 });

    await handle.db.delete(schema.user).where(eq(schema.user.id, u.id));
    expect(await handle.db.select().from(schema.items).where(eq(schema.items.userId, u.id))).toHaveLength(0);
    expect(await handle.db.select().from(schema.itemEvents).where(eq(schema.itemEvents.itemId, item.id))).toHaveLength(
      0,
    );
    expect(await handle.db.select().from(schema.profiles).where(eq(schema.profiles.userId, u.id))).toHaveLength(0);
    expect(await handle.db.select().from(schema.itemMedia).where(eq(schema.itemMedia.itemId, item.id))).toHaveLength(0);
    expect(
      await handle.db.select().from(schema.wishlistItems).where(eq(schema.wishlistItems.itemId, item.id)),
    ).toHaveLength(0);
    expect(await handle.db.select().from(schema.itemTags).where(eq(schema.itemTags.itemId, item.id))).toHaveLength(0);
    expect(await handle.db.select().from(schema.wishlists).where(eq(schema.wishlists.userId, u.id))).toHaveLength(0);
    expect(await handle.db.select().from(schema.tags).where(eq(schema.tags.userId, u.id))).toHaveLength(0);
  });
});
