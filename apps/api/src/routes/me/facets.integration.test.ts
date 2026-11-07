import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let counter = 0;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness();
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

function call(method: string, path: string, cookie: string | undefined, body?: unknown) {
  return t.app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

async function productOf(shopName: string, shopId?: string) {
  const n = ++counter;
  const id =
    shopId ??
    (
      await t.db
        .insert(t.schema.shops)
        .values({ name: shopName, slug: `facets-shop-${n}` })
        .returning()
    )[0]?.id;
  if (!id) throw new Error("no shop");
  const [product] = await t.db
    .insert(t.schema.products)
    .values({ shopId: id, canonicalUrl: `https://facets-${n}.test/p`, name: `Robe ${n}` })
    .returning();
  if (!product) throw new Error("no product");
  return { product, shopId: id };
}

async function keep(cookie: string, productId: string) {
  const res = await call("POST", "/api/me/items", cookie, { productId, action: "wish" });
  expect([200, 201]).toContain(res.status);
  return ((await res.json()) as { item: { id: string } }).item.id;
}

describe("GET /api/me/facets", () => {
  it("answers 401 without a session", async () => {
    expect((await call("GET", "/api/me/facets", undefined)).status).toBe(401);
  });

  it("lists the distinct shops of her non-deleted items by name, and only hers", async () => {
    const mine = await t.signIn();
    const other = await t.signIn();
    const zara = await productOf("Zara facets");
    await productOf("Zara facets", zara.shopId); // same shop, second product
    const etam = await productOf("Étam facets");
    const gone = await productOf("Oubliée facets");
    const theirs = await productOf("Secrète facets");
    await keep(mine.cookie, zara.product.id);
    await keep(mine.cookie, etam.product.id);
    const goneItem = await keep(mine.cookie, gone.product.id);
    await keep(other.cookie, theirs.product.id);
    expect((await call("DELETE", `/api/me/items/${goneItem}`, mine.cookie)).status).toBe(200);

    const res = await call("GET", "/api/me/facets", mine.cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      shops: [
        { id: etam.shopId, name: "Étam facets" },
        { id: zara.shopId, name: "Zara facets" },
      ],
    });
  });

  it("filters the items by shop id as well as by slug", async () => {
    const { cookie } = await t.signIn();
    const a = await productOf("Filtre A");
    const b = await productOf("Filtre B");
    await keep(cookie, a.product.id);
    await keep(cookie, b.product.id);
    const res = await call("GET", `/api/me/items?shop=${a.shopId}`, cookie);
    const body = (await res.json()) as { items: { product: { id: string } }[] };
    expect(body.items.map((i) => i.product.id)).toEqual([a.product.id]);
  });

  it("still finds a shop whose slug looks like a UUID", async () => {
    const { cookie } = await t.signIn();
    const slug = "0b1f6a52-3a0b-4a4c-8f0e-5b1c2d3e4f51";
    const [shop] = await t.db.insert(t.schema.shops).values({ name: "Slug UUID", slug }).returning();
    if (!shop) throw new Error("no shop");
    const other = await productOf("Autre");
    const mine = await productOf("Slug UUID", shop.id);
    await keep(cookie, mine.product.id);
    await keep(cookie, other.product.id);
    const res = await call("GET", `/api/me/items?shop=${slug}`, cookie);
    const body = (await res.json()) as { items: { product: { id: string } }[] };
    expect(body.items.map((i) => i.product.id)).toEqual([mine.product.id]);
  });
});
