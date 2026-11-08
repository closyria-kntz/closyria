import { schema } from "@closyria/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCatalogHarness } from "../catalog/test-app";

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let counter = 0;
const UNKNOWN_ID = "7b1f6a52-3a0b-4a4c-9f0e-5b1c2d3e4f50";
const DAY = 86_400_000;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness();
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

async function newProduct(overrides: Partial<typeof schema.products.$inferInsert> = {}) {
  const n = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `Boutique ${n}`, slug: `hist-shop-${n}` })
    .returning();
  if (!shop) throw new Error("no shop");
  const [product] = await t.db
    .insert(schema.products)
    .values({ shopId: shop.id, canonicalUrl: `https://hist-${n}.test/p`, ...overrides })
    .returning();
  if (!product) throw new Error("no product");
  return product;
}

const midnight = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`).getTime();

/** At noon UTC, `daysAgo` days ago, plus `hours` so two captures can share a day. */
async function seen(productId: string, daysAgo: number, priceCents: number, hours = 0) {
  await t.db.insert(schema.productHistory).values({
    productId,
    seenAt: new Date(midnight() - daysAgo * DAY + hours * 3_600_000),
    priceCents,
    sizes: {},
  });
}

const get = (id: string, query = "") => t.app.request(`/api/products/${id}/price-history${query}`);

describe("GET /api/products/:id/price-history", () => {
  it("has no points and nulls without history", async () => {
    const p = await newProduct();
    const res = await get(p.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ points: [], lowestSinceDays: null, dropCents: null, dropSince: null });
  });

  it("reports a drop 140, 140, 120", async () => {
    const p = await newProduct();
    await seen(p.id, 30, 14000);
    await seen(p.id, 10, 14000);
    await seen(p.id, 3, 12000);
    const body = (await (await get(p.id)).json()) as {
      points: { at: string; priceCents: number }[];
      lowestSinceDays: number;
      dropCents: number;
      dropSince: string;
    };
    expect(body.points.map((x) => x.priceCents)).toEqual([14000, 14000, 12000]);
    expect(body.dropCents).toBe(-2000);
    expect(body.dropSince).toBe(body.points[2]?.at.slice(0, 10));
    expect(body.lowestSinceDays).toBeGreaterThanOrEqual(1);
    expect((body.points[0]?.at ?? "") < (body.points[1]?.at ?? "")).toBe(true);
  });

  it("keeps the last capture of each day and gives null drop on a rise", async () => {
    const p = await newProduct();
    await seen(p.id, 5, 10000, 1);
    await seen(p.id, 3, 9000, 1);
    await seen(p.id, 3, 11000, 2);
    const body = (await (await get(p.id)).json()) as { points: { priceCents: number }[]; dropCents: number | null };
    expect(body.points.map((x) => x.priceCents)).toEqual([10000, 11000]);
    expect(body.dropCents).toBeNull();
  });

  it("limits to the window", async () => {
    const p = await newProduct();
    await seen(p.id, 40, 10000);
    await seen(p.id, 2, 9000);
    const body = (await (await get(p.id, "?days=7")).json()) as { points: unknown[] };
    expect(body.points).toHaveLength(1);
  });

  it("rejects a bad days", async () => {
    const p = await newProduct();
    for (const q of ["?days=0", "?days=366", "?days=x", "?days=1.5"]) {
      expect((await get(p.id, q)).status).toBe(400);
    }
  });

  it("404 for an unknown product", async () => {
    const res = await get(UNKNOWN_ID);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("is empty for a manual product", async () => {
    const p = await newProduct({ captureStatus: "manual" });
    await seen(p.id, 3, 12000);
    expect(await (await get(p.id)).json()).toEqual({
      points: [],
      lowestSinceDays: null,
      dropCents: null,
      dropSince: null,
    });
  });
});
