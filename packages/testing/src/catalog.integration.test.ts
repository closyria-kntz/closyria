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
