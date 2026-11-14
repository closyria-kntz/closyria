import { createDb, eq, schema } from "@closyria/db";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { writeProduct } from "./write-product";

// Detection fails after writing inside its savepoint: the product's own write must survive.
vi.mock("../alerts/detect", () => ({
  detectAlerts: vi.fn(async (tx: Parameters<typeof writeProduct>[0], productId: string) => {
    await tx.update(schema.products).set({ name: "Écrit par la détection" }).where(eq(schema.products.id, productId));
    throw new Error("detection boom");
  }),
}));

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let handle: ReturnType<typeof createDb>;

beforeAll(async () => {
  database = await createTestDatabase();
  handle = createDb(database.url, { max: 2 });
}, 60_000);

afterAll(async () => {
  await handle?.pool.end();
  await database?.stop();
});

describe("writeProduct with a failing detection", () => {
  it("commits the product and its history point, rolls back only the detection's savepoint", async () => {
    const { db } = handle;
    const [shop] = await db
      .insert(schema.shops)
      .values({ name: "Isolée", slug: "isolee", platform: "shopify", status: "published" })
      .returning();
    if (!shop) throw new Error("no shop");
    const [row] = await db
      .insert(schema.products)
      .values({ shopId: shop.id, canonicalUrl: "https://isolee.example/p", name: "Avant" })
      .returning();
    if (!row) throw new Error("no product");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await db.transaction((tx) =>
      writeProduct(tx, {
        productId: row.id,
        product: {
          name: "Robe Iris",
          currency: "EUR",
          priceCents: 7000,
          images: [],
          sizes: [{ label: "M", available: true }],
          platform: "shopify",
        },
        url: "https://isolee.example/p",
        listingKind: "catalog",
        reference: undefined,
        at: new Date("2026-11-14T13:00:00Z"),
        history: "always",
      }),
    );

    const [saved] = await db.select().from(schema.products).where(eq(schema.products.id, row.id));
    expect(saved).toMatchObject({ name: "Robe Iris", priceCents: 7000, captureStatus: "ok" });
    const history = await db.select().from(schema.productHistory).where(eq(schema.productHistory.productId, row.id));
    expect(history.map((h) => [h.priceCents, h.sizes])).toEqual([[7000, { M: true }]]);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining(row.id), expect.any(Error));
    errors.mockRestore();
  });
});
