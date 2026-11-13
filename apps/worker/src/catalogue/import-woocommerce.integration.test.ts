import type dns from "node:dns";
import { and, asc, createDb, eq, readShopifySlowdown, schema } from "@closyria/db";
import { memoryStore } from "@closyria/storage";
import { type FakeRoute, type FakeShop, startFakeShop } from "@closyria/testing";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AddressPolicy } from "../capture/address-policy";
import { createRobotsCache, safeRobotsFetcher } from "../capture/robots";
import { seedReference } from "../capture/seed-reference";
import { loopbackForTests } from "../capture/testing";
import { createThrottle, type ThrottleOptions } from "../capture/throttle";
import { importCatalog } from "./import-catalog";
import type { ImportDeps } from "./import-core";
import { WOO_VARIATION_BUDGET } from "./import-woocommerce";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let handle: ReturnType<typeof createDb>;
let counter = 0;

beforeAll(async () => {
  database = await createTestDatabase();
  handle = createDb(database.url, { max: 4 });
  await seedReference(handle.db);
}, 60_000);

afterAll(async () => {
  await handle?.pool.end();
  await database?.stop();
});

// 1x1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const JSON_TYPE = { "content-type": "application/json; charset=UTF-8" };
const API = "/wp-json/wc/store/v1/products";

const loopbackOnly: AddressPolicy = Object.assign((ip: string): boolean => ip === "127.0.0.1" && loopbackForTests(ip), {
  anyPortOnLoopback: true as const,
});
const noDns = ((host: string, _options: unknown, callback: (error: Error | null, addresses: never[]) => void) => {
  callback(Object.assign(new Error(`no DNS in tests: ${host}`), { code: "ENOTFOUND" }), []);
}) as unknown as typeof dns.lookup;

let shop: FakeShop;
let routes: Record<string, FakeRoute>;
let pauses: number[];
let lines: (ThrottleOptions | undefined)[];
let clock: Date;
let deps: ImportDeps;

beforeEach(async () => {
  routes = {};
  shop = await startFakeShop(routes);
  pauses = [];
  lines = [];
  clock = new Date("2026-11-13T10:00:00Z");
  const throttle = createThrottle(0);
  deps = {
    db: handle.db,
    store: memoryStore(),
    policy: loopbackOnly,
    lookup: noDns,
    robots: createRobotsCache(safeRobotsFetcher(loopbackOnly), Date.now),
    throttle: {
      wait: (domain, options) => {
        lines.push(options);
        return throttle.wait(domain, options);
      },
    },
    now: () => clock,
    sleep: async (ms) => {
      pauses.push(ms);
    },
  };
});

afterEach(async () => {
  await shop.close();
});

type WooProduct = {
  id: number;
  name: string;
  price?: string;
  regular?: string;
  inStock?: boolean;
  image?: boolean;
  /** Variable product: its sizes, each one variation (`id * 10 + index`). */
  sizes?: string[];
  category?: string;
};

function wooProduct(p: WooProduct) {
  if (p.image) routes[`/wp-content/uploads/${p.id}.png`] = { headers: { "content-type": "image/png" }, body: PNG };
  const prices = (price: string, regular = price) => ({
    price,
    regular_price: regular,
    sale_price: price,
    currency_code: "EUR",
    currency_minor_unit: 2,
  });
  return {
    id: p.id,
    name: p.name,
    type: p.sizes ? "variable" : "simple",
    permalink: `${shop.origin}/produit/produit-${p.id}/`,
    sku: "",
    description: "<p>Belle pièce</p>",
    short_description: "",
    prices: prices(p.price ?? "4990", p.regular),
    images: p.image ? [{ id: p.id, src: `${shop.origin}/wp-content/uploads/${p.id}.png` }] : [],
    categories: p.category ? [{ id: 1, name: p.category, slug: "c" }] : [],
    tags: [],
    attributes: p.sizes
      ? [
          {
            id: 1,
            name: "Taille",
            taxonomy: "pa_taille",
            has_variations: true,
            terms: p.sizes.map((s, i) => ({ id: i, name: s, slug: s.toLowerCase() })),
          },
        ]
      : [],
    variations: (p.sizes ?? []).map((s, i) => ({
      id: p.id * 10 + i,
      attributes: [{ name: "Taille", value: s.toLowerCase() }],
    })),
    is_in_stock: p.inStock ?? true,
    is_purchasable: true,
  };
}

const pagePath = (page: number) => `${API}?per_page=100&page=${page}`;

/** Serves the listing (with the shop's counts unless `counts` is false) and every variation, in stock by default. */
function servePages(pages: WooProduct[][], options: { counts?: boolean; outOfStock?: number[] } = {}) {
  for (const key of Object.keys(routes)) if (key.startsWith(API)) delete routes[key];
  const total = pages.reduce((n, page) => n + page.length, 0);
  pages.forEach((products, index) => {
    routes[pagePath(index + 1)] = {
      headers: {
        ...JSON_TYPE,
        ...(options.counts === false ? {} : { "x-wp-total": String(total), "x-wp-totalpages": String(pages.length) }),
      },
      body: JSON.stringify(products.map(wooProduct)),
    };
    for (const p of products) {
      (p.sizes ?? []).forEach((_, i) => {
        const id = p.id * 10 + i;
        serveVariation(id, !(options.outOfStock ?? []).includes(id));
      });
    }
  });
}

function serveVariation(id: number, inStock: boolean, price = "4990") {
  routes[`${API}/${id}`] = {
    headers: JSON_TYPE,
    body: JSON.stringify({
      id,
      type: "variation",
      is_in_stock: inStock,
      is_purchasable: true,
      prices: { price, regular_price: price, sale_price: price, currency_code: "EUR", currency_minor_unit: 2 },
    }),
  };
}

const variationHits = () => shop.hits.filter((hit) => /^\/wp-json\/wc\/store\/v1\/products\/\d+$/.test(hit));
const pageHits = () => shop.hits.filter((hit) => hit.startsWith(`${API}?`));

async function newShop(over: Partial<typeof schema.shops.$inferInsert> = {}) {
  const n = ++counter;
  const [s] = await handle.db
    .insert(schema.shops)
    .values({
      name: `Woo ${n}`,
      slug: `woo-shop-${n}`,
      platform: "woocommerce",
      status: "published",
      importEnabled: true,
      testUrl: `${shop.origin}/produit/test/`,
      ...over,
    })
    .returning();
  if (!s) throw new Error("no shop");
  return s;
}

const shopRow = async (id: string) => (await handle.db.select().from(schema.shops).where(eq(schema.shops.id, id)))[0];
const byExternalId = async (shopId: string, externalId: string) => {
  const [p] = await handle.db
    .select()
    .from(schema.products)
    .where(and(eq(schema.products.shopId, shopId), eq(schema.products.externalId, externalId)));
  if (!p) throw new Error(`no product ${externalId}`);
  return p;
};
const sizesOf = async (productId: string) =>
  (
    await handle.db
      .select({ label: schema.productSizes.label, available: schema.productSizes.available })
      .from(schema.productSizes)
      .where(eq(schema.productSizes.productId, productId))
      .orderBy(asc(schema.productSizes.position))
  ).map((s) => `${s.label}${s.available ? "" : " (épuisé)"}`);

/** A full first page (100 simple products) then `extra`. */
function twoPages(extra: WooProduct[] = []): WooProduct[][] {
  const first: WooProduct[] = Array.from({ length: 100 }, (_, i) => ({ id: 1000 + i, name: `Article ${i}` }));
  return [first, extra];
}

describe("WooCommerce catalogue import", () => {
  it("reads the Store API page by page, 1 s apart, off the Shopify line, and writes classified products", async () => {
    servePages(
      twoPages([
        { id: 1, name: "Robe portefeuille", category: "Robes", sizes: ["S", "M"], image: true },
        { id: 2, name: "Pull col roulé", price: "7900", regular: "9900" },
      ]),
    );
    const s = await newShop();
    const result = await importCatalog(deps, s.id);
    expect(result).toMatchObject({ created: 102, updated: 0, removed: 0, error: null });
    expect(pageHits()).toEqual([pagePath(1), pagePath(2)]);
    // Every request 1 s after the previous one; none on the Shopify line.
    expect(pauses.every((ms) => ms === 1000)).toBe(true);
    expect(pauses.length).toBe(shop.hits.filter((h) => h.startsWith(API)).length - 1);
    expect(lines.every((options) => options === undefined)).toBe(true);
    expect(shop.maxInFlight).toBe(1);

    const robe = await byExternalId(s.id, "1");
    expect(robe).toMatchObject({ name: "Robe portefeuille", priceCents: 4990, currency: "EUR", removedAt: null });
    expect(robe.canonicalUrl).toContain("/produit/produit-1");
    expect(robe.categoryId).not.toBeNull();
    expect(await sizesOf(robe.id)).toEqual(["S", "M"]);
    expect(robe.variantsCheckedAt).toEqual(clock);
    const pull = await byExternalId(s.id, "2");
    expect(pull).toMatchObject({ priceCents: 7900, compareAtCents: 9900, variantsCheckedAt: null });
    const images = await handle.db
      .select()
      .from(schema.productImages)
      .where(eq(schema.productImages.productId, robe.id));
    expect(images).toHaveLength(1);

    expect(await shopRow(s.id)).toMatchObject({
      importState: null,
      importPages: 2,
      importSeen: 102,
      importExpected: 102,
      lastImportError: null,
      lastImportSeen: 102,
      lastImportCreated: 102,
      lastImportRemoved: 0,
    });
  });

  it("without the shop's page count, stops at a short page; past an exact last page, a 400 ends the listing", async () => {
    servePages([[{ id: 1, name: "Robe" }]], { counts: false });
    const s = await newShop();
    expect((await importCatalog(deps, s.id)).error).toBeNull();
    expect(pageHits()).toEqual([pagePath(1)]);
    expect((await shopRow(s.id))?.importExpected).toBeNull();

    shop.hits.length = 0;
    servePages(twoPages(), { counts: false });
    delete routes[pagePath(2)];
    routes[pagePath(2)] = { status: 400, headers: JSON_TYPE, body: JSON.stringify({ code: "rest_invalid_param" }) };
    const full = await newShop();
    expect(await importCatalog(deps, full.id)).toMatchObject({ created: 100, error: null });
  });

  it("reads each size's stock from its variation; a gone variation is a size no longer on sale", async () => {
    servePages([[{ id: 1, name: "Robe", sizes: ["S", "M", "L"] }]], { outOfStock: [11] });
    delete routes[`${API}/12`];
    const s = await newShop();
    await importCatalog(deps, s.id);
    expect(variationHits()).toEqual([`${API}/10`, `${API}/11`, `${API}/12`]);
    expect(await sizesOf((await byExternalId(s.id, "1")).id)).toEqual(["S", "M (épuisé)", "L (épuisé)"]);
  });

  it("reads the variations again only for a changed product, or once a day", async () => {
    servePages([
      [
        { id: 1, name: "Robe", sizes: ["S", "M"] },
        { id: 2, name: "Jupe", sizes: ["S"] },
      ],
    ]);
    const s = await newShop();
    await importCatalog(deps, s.id);
    expect(variationHits()).toHaveLength(3);

    // An hour later, same listing: nothing to read again.
    shop.hits.length = 0;
    clock = new Date(clock.getTime() + 60 * 60_000);
    expect(await importCatalog(deps, s.id)).toMatchObject({ unchanged: 2, error: null });
    expect(variationHits()).toEqual([]);

    // The robe's price changes: only its variations are read again.
    servePages(
      [
        [
          { id: 1, name: "Robe", sizes: ["S", "M"], price: "3990" },
          { id: 2, name: "Jupe", sizes: ["S"] },
        ],
      ],
      {
        outOfStock: [10],
      },
    );
    shop.hits.length = 0;
    clock = new Date(clock.getTime() + 60 * 60_000);
    await importCatalog(deps, s.id);
    expect(variationHits()).toEqual([`${API}/10`, `${API}/11`]);
    expect(await sizesOf((await byExternalId(s.id, "1")).id)).toEqual(["S (épuisé)", "M"]);

    // A day after their last read, every variable product is read again, even unchanged.
    shop.hits.length = 0;
    clock = new Date(clock.getTime() + 25 * 60 * 60_000);
    await importCatalog(deps, s.id);
    expect(variationHits().sort()).toEqual([`${API}/10`, `${API}/11`, `${API}/20`]);
  });

  it("keeps the last known stock of each size when the listing changes and the variations cannot be read", async () => {
    servePages([[{ id: 1, name: "Robe", sizes: ["S", "M"] }]], { outOfStock: [10] });
    const s = await newShop();
    await importCatalog(deps, s.id);
    const robe = await byExternalId(s.id, "1");
    expect(await sizesOf(robe.id)).toEqual(["S (épuisé)", "M"]);

    servePages([[{ id: 1, name: "Robe", sizes: ["S", "M"], price: "3990" }]]);
    routes[`${API}/10`] = { status: 500, body: "oops" };
    clock = new Date(clock.getTime() + 60 * 60_000);
    expect((await importCatalog(deps, s.id)).error).toBeNull();
    expect((await byExternalId(s.id, "1")).priceCents).toBe(3990);
    expect(await sizesOf(robe.id)).toEqual(["S (épuisé)", "M"]);
  });

  it(`reads at most ${WOO_VARIATION_BUDGET} variations per import, the never-read products first`, async () => {
    const products: WooProduct[] = Array.from({ length: 110 }, (_, i) => ({
      id: 100 + i,
      name: `Robe ${i}`,
      sizes: ["S", "M", "L"],
    }));
    servePages([products.slice(0, 100), products.slice(100)]);
    const s = await newShop();
    await importCatalog(deps, s.id);
    expect(variationHits()).toHaveLength(WOO_VARIATION_BUDGET);
    const notChecked = (await handle.db.select().from(schema.products).where(eq(schema.products.shopId, s.id))).filter(
      (p) => p.variantsCheckedAt === null,
    );
    expect(notChecked).toHaveLength(10);

    // The next import reads those first (and the rest, checked an hour ago, waits for its day).
    shop.hits.length = 0;
    clock = new Date(clock.getTime() + 60 * 60_000);
    await importCatalog(deps, s.id);
    const read = new Set(variationHits().map((hit) => Math.floor(Number(hit.split("/").pop()) / 10)));
    expect([...read].sort()).toEqual(notChecked.map((p) => Number(p.externalId)).sort());
  });

  it("marks a product gone from the listing as removed, and removes nothing from a much shorter listing", async () => {
    servePages(twoPages([{ id: 1, name: "Robe" }]));
    const s = await newShop();
    await importCatalog(deps, s.id);
    // A product pasted by link (a SKU as its id) is not the import's to judge.
    await handle.db.insert(schema.products).values({
      shopId: s.id,
      canonicalUrl: `${shop.origin}/produit/collee/`,
      name: "Collée",
      externalId: "SKU-12",
    });

    servePages(twoPages());
    clock = new Date(clock.getTime() + 60 * 60_000);
    expect(await importCatalog(deps, s.id)).toMatchObject({ removed: 1, error: null });
    expect((await byExternalId(s.id, "1")).removedAt).toEqual(clock);
    expect((await byExternalId(s.id, "SKU-12")).removedAt).toBeNull();

    servePages([[{ id: 1000, name: "Article 0" }]]);
    clock = new Date(clock.getTime() + 60 * 60_000);
    expect(await importCatalog(deps, s.id)).toMatchObject({ removed: 0, error: "suspicious_shrink" });
    expect((await byExternalId(s.id, "1001")).removedAt).toBeNull();
    expect((await shopRow(s.id))?.lastImportError).toBe("suspicious_shrink");
  });

  it.each([401, 403, 429])(
    "stops at a %i, records it, removes nothing and never slows Shopify down",
    async (status) => {
      servePages([[{ id: 1, name: "Robe" }]]);
      const s = await newShop();
      await importCatalog(deps, s.id);
      routes[pagePath(1)] = { status, headers: JSON_TYPE, body: "{}" };
      shop.hits.length = 0;
      clock = new Date(clock.getTime() + 60 * 60_000);
      expect((await importCatalog(deps, s.id)).error).toBe(`blocked (HTTP ${status})`);
      // No second try after a refusal.
      expect(pageHits()).toEqual([pagePath(1)]);
      expect(await shopRow(s.id)).toMatchObject({ importState: null, lastImportError: `blocked (HTTP ${status})` });
      expect((await byExternalId(s.id, "1")).removedAt).toBeNull();
      expect(await readShopifySlowdown(handle.db, clock)).toBeNull();
    },
  );

  it("stops at a refused variation too, before any removal", async () => {
    servePages([[{ id: 1, name: "Robe", sizes: ["S", "M"] }]]);
    routes[`${API}/10`] = { status: 429, headers: JSON_TYPE, body: "{}" };
    const s = await newShop();
    expect((await importCatalog(deps, s.id)).error).toBe("blocked (HTTP 429)");
    expect(variationHits()).toEqual([`${API}/10`]);
    expect((await shopRow(s.id))?.lastImportAt).toBeNull();
  });

  it("stops with woocommerce_api_unavailable when the Store API is absent or disabled, and crawls nothing else", async () => {
    const s = await newShop();
    expect((await importCatalog(deps, s.id)).error).toBe("woocommerce_api_unavailable");
    expect(shop.hits.filter((hit) => hit !== "/robots.txt")).toEqual([pagePath(1)]);

    routes[pagePath(1)] = { headers: { "content-type": "text/html" }, body: "<html>Accueil</html>" };
    expect((await importCatalog(deps, s.id)).error).toBe("woocommerce_api_unavailable");
    routes[pagePath(1)] = { headers: JSON_TYPE, body: JSON.stringify({ code: "rest_disabled" }) };
    expect((await importCatalog(deps, s.id)).error).toBe("woocommerce_api_unavailable");
    expect(await shopRow(s.id)).toMatchObject({ importState: null, lastImportError: "woocommerce_api_unavailable" });
  });

  it("does not request what robots.txt forbids (/wp-json/)", async () => {
    servePages([[{ id: 1, name: "Robe" }]]);
    routes["/robots.txt"] = { headers: { "content-type": "text/plain" }, body: "User-agent: *\nDisallow: /wp-json/\n" };
    const s = await newShop();
    expect((await importCatalog(deps, s.id)).error).toBe("robots_disallowed");
    expect(pageHits()).toEqual([]);
  });

  it("skips an unchanged listing like Shopify's: only the check date moves", async () => {
    servePages([[{ id: 1, name: "Robe" }]]);
    const s = await newShop();
    await importCatalog(deps, s.id);
    const before = await byExternalId(s.id, "1");
    clock = new Date(clock.getTime() + 60 * 60_000);
    expect(await importCatalog(deps, s.id)).toMatchObject({ created: 0, updated: 0, unchanged: 1, error: null });
    const after = await byExternalId(s.id, "1");
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.lastCapturedAt).toEqual(clock);
  });

  it("dispatches by platform: Shopify through its own import, any other platform refused", async () => {
    const other = await newShop({ platform: "prestashop" });
    expect((await importCatalog(deps, other.id)).error).toBe("unsupported_platform");
    routes["/products.json?limit=250&page=1"] = { headers: JSON_TYPE, body: JSON.stringify({ products: [] }) };
    const shopify = await newShop({ platform: "shopify" });
    // An empty Shopify listing: read, nothing removed.
    expect((await importCatalog(deps, shopify.id)).error).toBe("suspicious_shrink");
    expect(shop.hits).toContain("/products.json?limit=250&page=1");
    expect(lines.at(-1)).toEqual({ shopify: "low" });
  });
});
