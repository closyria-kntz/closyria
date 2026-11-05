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

/** Rejects with a Postgres error carrying this SQLSTATE (drizzle wraps it in `cause`). */
async function expectSqlState(promise: PromiseLike<unknown>, code: string, constraint?: string) {
  const error = await Promise.resolve(promise).then(
    () => null,
    (e: unknown) => e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } },
  );
  if (!error) throw new Error(`expected SQLSTATE ${code}, but the statement succeeded`);
  const pg = error.cause ?? error;
  expect(pg.code).toBe(code);
  if (constraint) expect(pg.constraint).toBe(constraint);
}

async function newMedia(userId: string) {
  const id = crypto.randomUUID();
  await handle.db.insert(schema.media).values({
    id,
    userId,
    key: `users/${userId}/${id}.webp`,
    contentType: "image/webp",
    sizeBytes: 10,
    width: 3,
    height: 4,
  });
  return id;
}

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
    await expectSqlState(newItem(u.id, profile.id, p2.id, { stage: "gone" as never }), "23514", "items_stage_check");
  });

  it("refuses bad enumerations and overlong values", async () => {
    const u = await newUser();
    await expectSqlState(newProfile(u.id, { audience: "other" as never }), "23514", "profiles_audience_check");
    await expectSqlState(newProfile(u.id, { childDetail: "x" as never }), "23514", "profiles_child_detail_check");
    await expectSqlState(newProfile(u.id, { name: "" }), "23514", "profiles_name_check");
    await expectSqlState(newProfile(u.id, { name: "x".repeat(41) }), "23514", "profiles_name_check");
    const profile = await newProfile(u.id);
    const product = await newProduct();
    await expectSqlState(
      newItem(u.id, profile.id, product.id, { sizeLabel: "x".repeat(41) }),
      "23514",
      "items_size_label_check",
    );
    await expectSqlState(
      newItem(u.id, profile.id, product.id, { notes: "x".repeat(2001) }),
      "23514",
      "items_notes_check",
    );
    await expectSqlState(
      handle.db.insert(schema.wishlists).values({ userId: u.id, name: "x".repeat(81) }),
      "23514",
      "wishlists_name_check",
    );
    await expectSqlState(handle.db.insert(schema.tags).values({ userId: u.id, name: "" }), "23514", "tags_name_check");
  });

  it("allows one active item per product, but a deleted one next to an active one", async () => {
    const u = await newUser();
    const profile = await newProfile(u.id);
    const product = await newProduct();
    const first = await newItem(u.id, profile.id, product.id);
    await expectSqlState(newItem(u.id, profile.id, product.id), "23505", "items_user_id_product_id_active_idx");
    await handle.db.update(schema.items).set({ deletedAt: new Date() }).where(eq(schema.items.id, first.id));
    await newItem(u.id, profile.id, product.id);
    await handle.db.update(schema.items).set({ deletedAt: new Date() }).where(eq(schema.items.userId, u.id));
    await newItem(u.id, profile.id, product.id);
  });

  it("makes tag names unique per user, case-insensitively", async () => {
    const a = await newUser();
    const b = await newUser();
    await handle.db.insert(schema.tags).values({ userId: a.id, name: "Été" });
    await expectSqlState(
      handle.db.insert(schema.tags).values({ userId: a.id, name: "été" }),
      "23505",
      "tags_user_id_lower_name_idx",
    );
    await handle.db.insert(schema.tags).values({ userId: b.id, name: "Été" });
  });

  it("refuses to delete a profile that has an item", async () => {
    const u = await newUser();
    const profile = await newProfile(u.id);
    await newItem(u.id, profile.id, (await newProduct()).id);
    await expectSqlState(
      handle.db.delete(schema.profiles).where(eq(schema.profiles.id, profile.id)),
      "23503",
      "items_profile_id_profiles_id_fk",
    );
  });

  it("deletes everything with the user", async () => {
    const u = await newUser();
    const profile = await newProfile(u.id);
    const product = await newProduct();
    const item = await newItem(u.id, profile.id, product.id);
    await handle.db.insert(schema.itemEvents).values({ itemId: item.id, type: "stage", stage: "owned" });
    await expectSqlState(
      handle.db.insert(schema.itemEvents).values({ itemId: item.id, type: "gone" as never }),
      "23514",
      "item_events_type_check",
    );
    await expectSqlState(
      handle.db.insert(schema.itemEvents).values({ itemId: item.id, type: "stage", stage: "gone" }),
      "23514",
      "item_events_stage_check",
    );
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

  it("sets the cover to null when its media is deleted, and cascades to item_media", async () => {
    const u = await newUser();
    const profile = await newProfile(u.id);
    const mediaId = await newMedia(u.id);
    const item = await newItem(u.id, profile.id, (await newProduct()).id, { coverMediaId: mediaId });
    await handle.db.insert(schema.itemMedia).values({ itemId: item.id, mediaId, position: 0 });
    await handle.db.delete(schema.media).where(eq(schema.media.id, mediaId));
    const [after] = await handle.db.select().from(schema.items).where(eq(schema.items.id, item.id));
    expect(after?.coverMediaId).toBeNull();
    expect(await handle.db.select().from(schema.itemMedia).where(eq(schema.itemMedia.itemId, item.id))).toHaveLength(0);
    await expectSqlState(
      newItem(u.id, profile.id, (await newProduct()).id, { coverMediaId: crypto.randomUUID() }),
      "23503",
    );
  });

  it("sets category_id and color_id to null when the category or colour is deleted", async () => {
    const u = await newUser();
    const profile = await newProfile(u.id);
    const n = ++counter;
    const [category] = await handle.db
      .insert(schema.categories)
      .values({ slug: `cat-w${n}`, name: "Cat" })
      .returning();
    const [color] = await handle.db
      .insert(schema.colors)
      .values({ slug: `col-w${n}`, name: "Col", hex: "#112233" })
      .returning();
    if (!category || !color) throw new Error("no category/colour");
    const item = await newItem(u.id, profile.id, (await newProduct()).id, {
      categoryId: category.id,
      colorId: color.id,
    });
    await handle.db.delete(schema.categories).where(eq(schema.categories.id, category.id));
    await handle.db.delete(schema.colors).where(eq(schema.colors.id, color.id));
    const [after] = await handle.db.select().from(schema.items).where(eq(schema.items.id, item.id));
    expect(after?.categoryId).toBeNull();
    expect(after?.colorId).toBeNull();
  });

  it("sets the event profiles to null when a profile is deleted", async () => {
    const u = await newUser();
    const home = await newProfile(u.id);
    const from = await newProfile(u.id, { name: "A" });
    const to = await newProfile(u.id, { name: "B" });
    const item = await newItem(u.id, home.id, (await newProduct()).id);
    const [event] = await handle.db
      .insert(schema.itemEvents)
      .values({ itemId: item.id, type: "profile", fromProfileId: from.id, toProfileId: to.id })
      .returning();
    if (!event) throw new Error("no event");
    await handle.db.delete(schema.profiles).where(eq(schema.profiles.id, from.id));
    await handle.db.delete(schema.profiles).where(eq(schema.profiles.id, to.id));
    const [after] = await handle.db.select().from(schema.itemEvents).where(eq(schema.itemEvents.id, event.id));
    expect(after?.fromProfileId).toBeNull();
    expect(after?.toProfileId).toBeNull();
  });

  it("lets two items without a product coexist", async () => {
    const u = await newUser();
    const profile = await newProfile(u.id);
    await handle.db.insert(schema.items).values([
      { userId: u.id, profileId: profile.id, productId: null },
      { userId: u.id, profileId: profile.id, productId: null },
    ]);
  });
});
