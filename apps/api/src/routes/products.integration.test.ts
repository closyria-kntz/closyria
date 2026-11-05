import { eq, schema } from "@closyria/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../catalog/test-app";

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let counter = 0;
const UNKNOWN_ID = "7b1f6a52-3a0b-4a4c-9f0e-5b1c2d3e4f50";

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
    .values({ name: `Boutique ${n}`, slug: `prod-shop-${n}` })
    .returning();
  if (!shop) throw new Error("no shop");
  const [product] = await t.db
    .insert(schema.products)
    .values({ shopId: shop.id, canonicalUrl: `https://prod-${n}.test/p`, ...overrides })
    .returning();
  if (!product) throw new Error("no product");
  return product;
}

function put(id: string, body: unknown, cookie?: string) {
  return t.app.request(`/api/products/${id}/manual`, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

describe("GET /api/products/:id", () => {
  it("answers without a session", async () => {
    const product = await newProduct({ name: "Robe", currency: "EUR", priceCents: 2999, brand: "Marque" });
    const res = await t.app.request(`/api/products/${product.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: product.id,
      name: "Robe",
      brand: "Marque",
      currency: "EUR",
      priceCents: 2999,
      compareAtCents: null,
      sizes: [],
      images: [],
      source: "captured",
      captureStatus: "pending",
      lastCapturedAt: null,
      shop: { name: expect.stringContaining("Boutique") },
    });
  });

  it("answers 404 for an unknown product and 400 for a malformed id", async () => {
    expect((await t.app.request(`/api/products/${UNKNOWN_ID}`)).status).toBe(404);
    expect((await t.app.request("/api/products/nope")).status).toBe(400);
  });
});

describe("PUT /api/products/:id/manual", () => {
  it("answers 401 without a session and 404 for an unknown product", async () => {
    const { cookie } = await t.signIn();
    const body = { name: "Robe", sizes: [] };
    expect((await put(UNKNOWN_ID, body)).status).toBe(401);
    expect((await put(UNKNOWN_ID, body, cookie)).status).toBe(404);
  });

  it("answers 400 for an invalid body", async () => {
    const { cookie } = await t.signIn();
    const product = await newProduct();
    const res = await put(product.id, { name: "", sizes: [] }, cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });

  it("fills an empty product and makes it manual", async () => {
    const { cookie } = await t.signIn();
    const product = await newProduct({ captureStatus: "failed" });
    const res = await put(product.id, { name: "Robe rose", priceCents: 1999, sizes: ["S", "M", "S"] }, cookie);
    expect(res.status).toBe(200);
    const view = (await res.json()) as {
      name: string;
      priceCents: number;
      currency: string;
      source: string;
      sizes: object[];
    };
    expect(view).toMatchObject({ name: "Robe rose", priceCents: 1999, currency: "EUR", source: "manual" });
    expect(view.sizes).toEqual([
      { label: "S", available: true },
      { label: "M", available: true },
    ]);
    const [row] = await t.db.select().from(schema.products).where(eq(schema.products.id, product.id));
    expect(row?.source).toBe("manual");
  });

  it("does not replace a captured name, price or sizes, and keeps source captured", async () => {
    const { cookie } = await t.signIn();
    const product = await newProduct({
      name: "Robe capturée",
      currency: "USD",
      priceCents: 4200,
      captureStatus: "ok",
      lastCapturedAt: new Date("2026-11-05T10:00:00Z"),
    });
    await t.db.insert(schema.productSizes).values({ productId: product.id, label: "L", position: 0, available: false });
    const res = await put(product.id, { name: "Autre", priceCents: 1, sizes: ["XS"] }, cookie);
    expect(res.status).toBe(200);
    const view = (await res.json()) as {
      name: string;
      priceCents: number;
      currency: string;
      source: string;
      sizes: { label: string }[];
    };
    expect(view).toMatchObject({ name: "Robe capturée", priceCents: 4200, currency: "USD", source: "captured" });
    expect(view.sizes.map((s) => s.label)).toEqual(["L"]);
  });

  it("fills only the missing field of a product with a name but no price", async () => {
    const { cookie } = await t.signIn();
    const product = await newProduct({ name: "Déjà nommée" });
    const view = (await (await put(product.id, { name: "Autre", priceCents: 500, sizes: [] }, cookie)).json()) as {
      name: string;
      priceCents: number;
      currency: string;
    };
    expect(view).toMatchObject({ name: "Déjà nommée", priceCents: 500, currency: "EUR" });
  });

  it("shares its counters with the captures: the 31st call of an anonymous session gets 429", async () => {
    const { cookie } = await t.signIn();
    const product = await newProduct();
    for (let i = 0; i < 30; i++) expect((await put(product.id, { name: "N", sizes: [] }, cookie)).status).toBe(200);
    const res = await put(product.id, { name: "N", sizes: [] }, cookie);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
  });
});

describe("GET /api/catalog-images/:id", () => {
  async function image(key: string, body?: Buffer) {
    const product = await newProduct();
    if (body) await t.store.put(key, body, "image/webp");
    const [row] = await t.db
      .insert(schema.productImages)
      .values({ productId: product.id, position: 0, key, width: 10, height: 10, sourceHash: key })
      .returning();
    if (!row) throw new Error("no image");
    return row;
  }

  it("serves the WebP without a session, cached for a year", async () => {
    const bytes = Buffer.from("RIFF....WEBPfake");
    const row = await image(`products/x/${++counter}.webp`, bytes);
    const res = await t.app.request(`/api/catalog-images/${row.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
  });

  it("answers 400 for a malformed id, 404 for an unknown id and for a missing object", async () => {
    expect((await t.app.request("/api/catalog-images/nope")).status).toBe(400);
    expect((await t.app.request(`/api/catalog-images/${UNKNOWN_ID}`)).status).toBe(404);
    const row = await image(`products/x/${++counter}.webp`);
    expect((await t.app.request(`/api/catalog-images/${row.id}`)).status).toBe(404);
  });
});
