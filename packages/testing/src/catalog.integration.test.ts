import { createDb, eq, schema } from "@closyria/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "./postgres";
import { createTestDatabase } from "./vitest";

// packages/db has no test runner of its own (it would make a dependency cycle with this package).
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

async function newShop(overrides: Partial<typeof schema.shops.$inferInsert> = {}) {
  const n = ++counter;
  const [shop] = await handle.db
    .insert(schema.shops)
    .values({ name: `Shop ${n}`, slug: `shop-${n}`, ...overrides })
    .returning();
  if (!shop) throw new Error("no shop");
  return shop;
}

async function newProduct(shopId: string, canonicalUrl = `https://shop.test/p/${++counter}`) {
  const [product] = await handle.db
    .insert(schema.products)
    .values({ shopId, canonicalUrl, name: "Robe", currency: "EUR", priceCents: 2999 })
    .returning();
  if (!product) throw new Error("no product");
  return product;
}

describe("catalog tables", () => {
  it("applies the column defaults", async () => {
    const shop = await newShop();
    expect(shop.status).toBe("pending");
    expect(shop.platform).toBe("unknown");
    expect(shop.captureMode).toBe("auto");
    expect(shop.listingKind).toBe("catalog");
    const product = await newProduct(shop.id);
    expect(product.captureStatus).toBe("pending");
    expect(product.source).toBe("captured");
  });

  it("refuses a second product with the same canonical_url", async () => {
    const shop = await newShop();
    const url = `https://shop.test/dup/${++counter}`;
    await newProduct(shop.id, url);
    await expect(newProduct(shop.id, url)).rejects.toThrow();
  });

  it("refuses capture_mode = 'other' with the CHECK", async () => {
    await expect(newShop({ captureMode: "other" as never })).rejects.toThrow();
  });

  it("refuses values outside the closed sets and duplicate keys", async () => {
    const shop = await newShop();
    await expect(newShop({ slug: shop.slug })).rejects.toThrow();
    await expect(newShop({ status: "nope" as never })).rejects.toThrow();
    const product = await newProduct(shop.id);
    await expect(
      handle.db
        .update(schema.products)
        .set({ captureStatus: "nope" as never })
        .where(eq(schema.products.id, product.id)),
    ).rejects.toThrow();
    await handle.db.insert(schema.shopDomains).values({ domain: `d${counter}.test`, shopId: shop.id });
    await expect(
      handle.db.insert(schema.shopDomains).values({ domain: `d${counter}.test`, shopId: shop.id }),
    ).rejects.toThrow();
    await handle.db
      .insert(schema.productSizes)
      .values({ productId: product.id, label: "M", position: 0, available: true });
    await expect(
      handle.db
        .insert(schema.productSizes)
        .values({ productId: product.id, label: "M", position: 1, available: false }),
    ).rejects.toThrow();
    const image = { productId: product.id, position: 0, key: "k", width: 10, height: 10, sourceHash: "h" };
    await handle.db.insert(schema.productImages).values(image);
    await expect(handle.db.insert(schema.productImages).values({ ...image, key: "k2" })).rejects.toThrow();
    await expect(
      handle.db
        .insert(schema.captures)
        .values({ shopId: shop.id, url: "https://shop.test/p", trigger: "user", status: "bad" as never }),
    ).rejects.toThrow();
  });

  it("deleting a product deletes its sizes, images, history and nulls captures.product_id", async () => {
    const shop = await newShop();
    const product = await newProduct(shop.id);
    await handle.db
      .insert(schema.productSizes)
      .values({ productId: product.id, label: "L", position: 0, available: true });
    await handle.db
      .insert(schema.productImages)
      .values({ productId: product.id, position: 0, key: "x", width: 1, height: 1, sourceHash: "a" });
    await handle.db
      .insert(schema.productHistory)
      .values({ productId: product.id, priceCents: 100, sizes: { L: true } });
    const [capture] = await handle.db
      .insert(schema.captures)
      .values({ shopId: shop.id, productId: product.id, url: "https://shop.test/p", trigger: "monitor" })
      .returning();
    expect(capture?.status).toBe("queued");

    await handle.db.delete(schema.products).where(eq(schema.products.id, product.id));

    expect(
      await handle.db.select().from(schema.productSizes).where(eq(schema.productSizes.productId, product.id)),
    ).toEqual([]);
    expect(
      await handle.db.select().from(schema.productImages).where(eq(schema.productImages.productId, product.id)),
    ).toEqual([]);
    expect(
      await handle.db.select().from(schema.productHistory).where(eq(schema.productHistory.productId, product.id)),
    ).toEqual([]);
    const [after] = await handle.db
      .select()
      .from(schema.captures)
      .where(eq(schema.captures.id, capture?.id ?? ""));
    expect(after?.productId).toBeNull();
  });
});

describe("reference lists and product classification", () => {
  it("stores a child category under its parent", async () => {
    const n = ++counter;
    const [parent] = await handle.db
      .insert(schema.categories)
      .values({ slug: `clothes-${n}`, name: "Vêtements", position: 0 })
      .returning();
    const [child] = await handle.db
      .insert(schema.categories)
      .values({ parentId: parent?.id, slug: `dresses-${n}`, name: "Robes", position: 0 })
      .returning();
    expect(child?.parentId).toBe(parent?.id);
    expect(child?.keywords).toEqual([]);
    await expect(
      handle.db.insert(schema.categories).values({ slug: `dresses-${n}`, name: "Doublon", position: 1 }),
    ).rejects.toThrow();
  });

  it("refuses a colour hex that is not #RRGGBB", async () => {
    const n = ++counter;
    await expect(
      handle.db.insert(schema.colors).values({ slug: `bad-${n}`, name: "Bad", hex: "red" }),
    ).rejects.toThrow();
  });

  it("refuses audience = 'kids' and applies the classification defaults", async () => {
    const shop = await newShop();
    const product = await newProduct(shop.id);
    expect(product.shopData).toEqual({});
    expect(product.classifiedBy).toBe("rule");
    expect(product.audience).toBeNull();
    await expect(
      handle.db
        .update(schema.products)
        .set({ audience: "kids" as never })
        .where(eq(schema.products.id, product.id)),
    ).rejects.toThrow();
    await expect(
      handle.db
        .update(schema.products)
        .set({ season: "spring" as never })
        .where(eq(schema.products.id, product.id)),
    ).rejects.toThrow();
  });

  it("sets products.color_id to null when the colour is deleted", async () => {
    const n = ++counter;
    const [color] = await handle.db
      .insert(schema.colors)
      .values({ slug: `blue-${n}`, name: "Bleu", hex: "#0000FF" })
      .returning();
    const shop = await newShop();
    const product = await newProduct(shop.id);
    await handle.db
      .update(schema.products)
      .set({ colorId: color?.id, audience: "child", childDetail: "baby", season: "all" })
      .where(eq(schema.products.id, product.id));
    await handle.db.delete(schema.colors).where(eq(schema.colors.id, color?.id ?? ""));
    const [after] = await handle.db.select().from(schema.products).where(eq(schema.products.id, product.id));
    expect(after?.colorId).toBeNull();
    expect(after?.audience).toBe("child");
  });

  it("refuses deleting a category that still has a child", async () => {
    const n = ++counter;
    const [parent] = await handle.db
      .insert(schema.categories)
      .values({ slug: `p-${n}`, name: "Parent", position: 0 })
      .returning();
    await handle.db
      .insert(schema.categories)
      .values({ parentId: parent?.id, slug: `c-${n}`, name: "Child", position: 0 });
    await expect(
      handle.db.delete(schema.categories).where(eq(schema.categories.id, parent?.id ?? "")),
    ).rejects.toThrow();
  });

  it("refuses an invalid child_detail and classified_by", async () => {
    const product = await newProduct((await newShop()).id);
    const update = (set: Partial<typeof schema.products.$inferInsert>) =>
      handle.db.update(schema.products).set(set).where(eq(schema.products.id, product.id));
    await expect(update({ childDetail: "man" as never })).rejects.toThrow();
    await expect(update({ classifiedBy: "ai" as never })).rejects.toThrow();
  });

  it("refuses a duplicate slug on colors, materials and patterns", async () => {
    const n = ++counter;
    await handle.db.insert(schema.colors).values({ slug: `c-${n}`, name: "A", hex: "#000000" });
    await expect(
      handle.db.insert(schema.colors).values({ slug: `c-${n}`, name: "B", hex: "#111111" }),
    ).rejects.toThrow();
    await handle.db.insert(schema.materials).values({ slug: `m-${n}`, name: "A" });
    await expect(handle.db.insert(schema.materials).values({ slug: `m-${n}`, name: "B" })).rejects.toThrow();
    await handle.db.insert(schema.patterns).values({ slug: `p-${n}`, name: "A" });
    await expect(handle.db.insert(schema.patterns).values({ slug: `p-${n}`, name: "B" })).rejects.toThrow();
  });

  it("sets category_id, material_id and pattern_id to null when their row is deleted", async () => {
    const n = ++counter;
    const [category] = await handle.db
      .insert(schema.categories)
      .values({ slug: `k-${n}`, name: "K" })
      .returning();
    const [material] = await handle.db
      .insert(schema.materials)
      .values({ slug: `mat-${n}`, name: "M" })
      .returning();
    const [pattern] = await handle.db
      .insert(schema.patterns)
      .values({ slug: `pat-${n}`, name: "P" })
      .returning();
    const product = await newProduct((await newShop()).id);
    await handle.db
      .update(schema.products)
      .set({ categoryId: category?.id, materialId: material?.id, patternId: pattern?.id })
      .where(eq(schema.products.id, product.id));
    await handle.db.delete(schema.categories).where(eq(schema.categories.id, category?.id ?? ""));
    await handle.db.delete(schema.materials).where(eq(schema.materials.id, material?.id ?? ""));
    await handle.db.delete(schema.patterns).where(eq(schema.patterns.id, pattern?.id ?? ""));
    const [after] = await handle.db.select().from(schema.products).where(eq(schema.products.id, product.id));
    expect(after?.categoryId).toBeNull();
    expect(after?.materialId).toBeNull();
    expect(after?.patternId).toBeNull();
  });
});
