import { eq, schema } from "@closyria/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../catalog/test-app";
import { loadItemViews } from "./item-view";

// A transaction is one connection: its queries must run one after another (pg 8 warns on queries sent while one
// runs, pg 9 refuses them). Parked item of « Après la commande » (Task 4 review), closed in the final fix wave.

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness();
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

describe("loadItemViews in a transaction", () => {
  it("sends its queries one at a time (no concurrent query on the transaction's connection)", async () => {
    const session = await t.signIn();
    const profiles = await t.app.request("/api/me/profiles", { headers: { origin: BASE_URL, cookie: session.cookie } });
    const profileId = ((await profiles.json()) as { profiles: { id: string }[] }).profiles[0]?.id as string;
    // An article without a product, from an order: the bare-item facts are read too.
    const [item] = await t.db
      .insert(schema.items)
      .values({ userId: session.userId, profileId, stage: "ordered", nameOverride: "Robe Lila" })
      .returning();
    const [order] = await t.db
      .insert(schema.orders)
      .values({
        userId: session.userId,
        profileId,
        shopName: "Atelier Nuit",
        status: "confirmed",
        source: "manual",
        parseMethod: "manual",
      })
      .returning();
    await t.db.insert(schema.orderLines).values({ orderId: order?.id as string, itemId: item?.id, name: "Robe Lila" });
    // And one with a product (its shop, photos, sizes and reference lists are read too).
    const [shop] = await t.db.insert(schema.shops).values({ name: "Maison Iris", slug: "item-view-iris" }).returning();
    const [product] = await t.db
      .insert(schema.products)
      .values({ shopId: shop?.id as string, canonicalUrl: "https://iris.test/p/1", name: "Chemise Iris" })
      .returning();
    const [wish] = await t.db
      .insert(schema.items)
      .values({ userId: session.userId, profileId, productId: product?.id, stage: "spotted" })
      .returning();

    const warnings: string[] = [];
    const onWarning = (warning: Error) => warnings.push(warning.message);
    process.on("warning", onWarning);
    try {
      const views = await t.db.transaction((tx) =>
        loadItemViews(tx, session.userId, [item?.id as string, wish?.id as string]),
      );
      expect(views.map((v) => v.shopName)).toEqual(["Atelier Nuit", "Maison Iris"]);
      // Warnings are emitted on the next tick.
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off("warning", onWarning);
    }
    expect(warnings.filter((w) => w.includes("already executing a query"))).toEqual([]);
    const [row] = await t.db
      .select()
      .from(schema.items)
      .where(eq(schema.items.id, item?.id as string));
    expect(row?.stage).toBe("ordered");
  });
});
