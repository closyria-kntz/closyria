import type dns from "node:dns";
import { and, asc, createDb, eq, readShopifySlowdown, schema } from "@closyria/db";
import { memoryStore } from "@closyria/storage";
import { type FakeRoute, type FakeShop, startFakeShop } from "@closyria/testing";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressPolicy } from "../capture/address-policy";
import { createRobotsCache, safeRobotsFetcher } from "../capture/robots";
import { seedReference } from "../capture/seed-reference";
import { loopbackForTests } from "../capture/testing";
import { createThrottle, type ThrottleOptions } from "../capture/throttle";
import { importCatalog } from "./import-catalog";
import type { ImportDeps } from "./import-core";
import { WOO_VARIATION_REQUESTS } from "./import-woocommerce";

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
const PLAIN = "/?rest_route=/wc/store/v1/products";
const HOUR = 60 * 60_000;

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
/** The shop's variations: id → its product and stock. A variation absent is gone (neither listed nor served). */
let variations: Map<number, { parent: number; inStock: boolean }>;
/** What the variations listing answers instead (400: an older WooCommerce; 500: a failure). */
let bulkStatus: number | null;
/** The variations listing answers 400 from its n-th request on (an older WooCommerce behind a cache, say). */
let bulkRefusedFrom: number | null;
/** No page count on the variations listing, and this status past its last page. */
let bulkPastEnd: number | null;
/** With the shop's page count, this page of the variations listing answers 404 all the same. */
let bulkMissingPage: number | null;
/** Variations listed in a shape the parser rejects. */
let broken: Set<number>;
/** Runs at each pause (before each request after the first): what the admin sees meanwhile. */
let duringPause: (() => Promise<void>) | null;

beforeEach(async () => {
  routes = {};
  variations = new Map();
  bulkStatus = null;
  bulkRefusedFrom = null;
  bulkPastEnd = null;
  bulkMissingPage = null;
  broken = new Set();
  duringPause = null;
  shop = await startFakeShop(routes);
  routes[API] = { dynamic: listVariations };
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
      await duringPause?.();
    },
  };
});

afterEach(async () => {
  await shop.close();
});

const prices = (price: string, regular = price) => ({
  price,
  regular_price: regular,
  sale_price: price,
  currency_code: "EUR",
  currency_minor_unit: 2,
});

/** A variation as the Store API gives it (the product schema of a `variation`, with its `parent`). */
const variationJson = (id: number, parent: number, inStock: boolean) => ({
  id,
  parent,
  type: "variation",
  variation: "Taille: x",
  is_in_stock: inStock,
  is_purchasable: true,
  prices: prices("4990"),
});

/** `…/products?type=variation&parent[]=…&per_page=100&page=n`: the variations of those products, 100 a page. */
function listVariations(url: URL): FakeRoute {
  if (url.searchParams.get("type") !== "variation") return { status: 404, body: "not found" };
  const refusal = (status: number) => ({
    status,
    headers: JSON_TYPE,
    body: JSON.stringify({ code: "rest_invalid_param" }),
  });
  if (bulkStatus) return refusal(bulkStatus);
  // `bulkHits` already holds this request.
  if (bulkRefusedFrom !== null && bulkHits().length >= bulkRefusedFrom) return refusal(400);
  const parents = new Set(url.searchParams.getAll("parent[]").map(Number));
  const all = [...variations].filter(([, v]) => parents.has(v.parent));
  const page = Number(url.searchParams.get("page") ?? 1);
  const perPage = Number(url.searchParams.get("per_page") ?? 10);
  const pages = Math.max(1, Math.ceil(all.length / perPage));
  if (bulkPastEnd !== null && page > pages) return refusal(bulkPastEnd);
  if (bulkMissingPage === page) return refusal(404);
  const slice = all.slice((page - 1) * perPage, page * perPage);
  return {
    headers: {
      ...JSON_TYPE,
      ...(bulkPastEnd !== null ? {} : { "x-wp-total": String(all.length), "x-wp-totalpages": String(pages) }),
    },
    body: JSON.stringify(
      slice.map(([id, v]) =>
        broken.has(id) ? { id, parent: v.parent, type: "variation" } : variationJson(id, v.parent, v.inStock),
      ),
    ),
  };
}

type WooProduct = {
  id: number;
  name: string;
  price?: string;
  regular?: string;
  inStock?: boolean;
  image?: boolean;
  /** Variable product: its sizes, each one variation (`variationId(id, index)`). */
  sizes?: string[];
  category?: string;
};

const variationId = (productId: number, index: number) => productId * 10_000 + index;

function wooProduct(p: WooProduct) {
  if (p.image) routes[`/wp-content/uploads/${p.id}.png`] = { headers: { "content-type": "image/png" }, body: PNG };
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
      id: variationId(p.id, i),
      attributes: [{ name: "Taille", value: s.toLowerCase() }],
    })),
    is_in_stock: p.inStock ?? true,
    is_purchasable: true,
  };
}

const pagePath = (page: number) => `${API}?per_page=100&page=${page}`;
const plainPagePath = (page: number) => `${PLAIN}&per_page=100&page=${page}`;

/**
 * Serves the listing (with the shop's counts unless `counts` is false) and every variation, in stock unless in
 * `outOfStock`, not at all when in `gone`; each variation also one by one.
 */
function servePages(
  pages: WooProduct[][],
  options: { counts?: boolean; outOfStock?: number[]; gone?: number[]; plain?: boolean } = {},
) {
  for (const key of Object.keys(routes)) if (key.startsWith(`${API}?`) || key.startsWith(`${API}/`)) delete routes[key];
  variations.clear();
  const total = pages.reduce((n, page) => n + page.length, 0);
  pages.forEach((products, index) => {
    routes[(options.plain ? plainPagePath : pagePath)(index + 1)] = {
      headers: {
        ...JSON_TYPE,
        ...(options.counts === false ? {} : { "x-wp-total": String(total), "x-wp-totalpages": String(pages.length) }),
      },
      body: JSON.stringify(products.map(wooProduct)),
    };
    for (const p of products) {
      (p.sizes ?? []).forEach((_, i) => {
        const id = variationId(p.id, i);
        if ((options.gone ?? []).includes(id)) return;
        const inStock = !(options.outOfStock ?? []).includes(id);
        variations.set(id, { parent: p.id, inStock });
        routes[`${API}/${id}`] = { headers: JSON_TYPE, body: JSON.stringify(variationJson(id, p.id, inStock)) };
      });
    }
  });
}

const bulkHits = () => shop.hits.filter((hit) => hit.startsWith(`${API}?type=variation`));
const oneByOneHits = () => shop.hits.filter((hit) => /^\/wp-json\/wc\/store\/v1\/products\/\d+$/.test(hit));
const variationRequests = () => [...bulkHits(), ...oneByOneHits()];
/** The products whose variations were listed, in order. */
const bulkParents = () =>
  bulkHits().flatMap((hit) => new URL(hit, "http://x").searchParams.getAll("parent[]").map(Number));
const pageHits = () => shop.hits.filter((hit) => hit.startsWith(`${API}?per_page`));

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
const productsOf = (shopId: string) =>
  handle.db.select().from(schema.products).where(eq(schema.products.shopId, shopId));
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

const later = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
  shop.hits.length = 0;
};

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
    expect(result.skipped).toBeUndefined();
    expect(pageHits()).toEqual([pagePath(1), pagePath(2)]);
    // Then its variations, listed at once: one more request.
    expect(bulkHits()).toEqual([`${API}?type=variation&parent[]=1&per_page=100&page=1`]);
    expect(oneByOneHits()).toEqual([]);
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
      importPhase: null,
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

    later(0);
    servePages(twoPages(), { counts: false });
    routes[pagePath(2)] = { status: 400, headers: JSON_TYPE, body: JSON.stringify({ code: "rest_invalid_param" }) };
    const full = await newShop();
    expect(await importCatalog(deps, full.id)).toMatchObject({ created: 100, error: null });
  });

  it("shows « lecture des tailles » while it reads the variations, and clears it at the end", async () => {
    servePages(twoPages([{ id: 1, name: "Robe", sizes: ["S", "M"] }]));
    const s = await newShop();
    const phases: (string | null)[] = [];
    duringPause = async () => {
      phases.push((await shopRow(s.id))?.importPhase ?? null);
    };
    await importCatalog(deps, s.id);
    // The pause before the variations' request: the pages are read, the sizes come next.
    expect(phases.at(-1)).toBe("sizes");
    expect(phases[0]).toBeNull();
    expect((await shopRow(s.id))?.importPhase).toBeNull();
  });

  it("a variation the listing does not hold is a size no longer on sale", async () => {
    servePages([[{ id: 1, name: "Robe", sizes: ["S", "M", "L"] }]], {
      outOfStock: [variationId(1, 1)],
      gone: [variationId(1, 2)],
    });
    const s = await newShop();
    await importCatalog(deps, s.id);
    expect(variationRequests()).toHaveLength(1);
    expect(await sizesOf((await byExternalId(s.id, "1")).id)).toEqual(["S", "M (épuisé)", "L (épuisé)"]);
  });

  it("lists the variations of 25 products per request", async () => {
    const products = Array.from({ length: 60 }, (_, i) => ({ id: 100 + i, name: `Robe ${i}`, sizes: ["S", "M"] }));
    servePages([products]);
    const s = await newShop();
    await importCatalog(deps, s.id);
    expect(bulkHits().map((hit) => new URL(hit, "http://x").searchParams.getAll("parent[]").length)).toEqual([
      25, 25, 10,
    ]);
    expect(bulkParents()).toEqual(products.map((p) => p.id));
    expect((await productsOf(s.id)).every((p) => p.variantsCheckedAt !== null)).toBe(true);
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
    expect(bulkParents()).toEqual([1, 2]);

    // An hour later, same listing: nothing to read again.
    later(HOUR);
    expect(await importCatalog(deps, s.id)).toMatchObject({ unchanged: 2, error: null });
    expect(variationRequests()).toEqual([]);
    expect((await shopRow(s.id))?.importPhase).toBeNull();

    // The robe's price changes: only its variations are read again.
    servePages(
      [
        [
          { id: 1, name: "Robe", sizes: ["S", "M"], price: "3990" },
          { id: 2, name: "Jupe", sizes: ["S"] },
        ],
      ],
      { outOfStock: [variationId(1, 0)] },
    );
    later(HOUR);
    await importCatalog(deps, s.id);
    expect(bulkParents()).toEqual([1]);
    expect(await sizesOf((await byExternalId(s.id, "1")).id)).toEqual(["S (épuisé)", "M"]);

    // A day after their last read, every variable product is read again, even unchanged.
    later(25 * HOUR);
    await importCatalog(deps, s.id);
    expect(bulkParents().sort()).toEqual([1, 2]);
  });

  it("keeps the last known stock when the variations cannot be read, and tries again only 24 h later", async () => {
    servePages([[{ id: 1, name: "Robe", sizes: ["S", "M"] }]], { outOfStock: [variationId(1, 0)] });
    const s = await newShop();
    await importCatalog(deps, s.id);
    const robe = await byExternalId(s.id, "1");
    expect(await sizesOf(robe.id)).toEqual(["S (épuisé)", "M"]);

    servePages([[{ id: 1, name: "Robe", sizes: ["S", "M"], price: "3990" }]]);
    bulkStatus = 500;
    later(HOUR);
    expect((await importCatalog(deps, s.id)).error).toBeNull();
    expect((await byExternalId(s.id, "1")).priceCents).toBe(3990);
    expect(await sizesOf(robe.id)).toEqual(["S (épuisé)", "M"]);
    expect((await byExternalId(s.id, "1")).variantsTriedAt).toEqual(clock);

    // Changed again an hour later: no new try within 24 h.
    servePages([[{ id: 1, name: "Robe", sizes: ["S", "M"], price: "3490" }]]);
    later(HOUR);
    await importCatalog(deps, s.id);
    expect(variationRequests()).toEqual([]);

    // A day later it is read, and the failure is forgotten.
    bulkStatus = null;
    later(24 * HOUR);
    await importCatalog(deps, s.id);
    expect(bulkParents()).toEqual([1]);
    expect(await byExternalId(s.id, "1")).toMatchObject({ variantsTriedAt: null, variantsCheckedAt: clock });
    expect(await sizesOf(robe.id)).toEqual(["S", "M"]);
  });

  it(`makes at most ${WOO_VARIATION_REQUESTS} variation requests per import, the never-read products first`, async () => {
    // 40 products of 100 sizes: one listing request per product.
    const sizes = Array.from({ length: 100 }, (_, i) => `T${i}`);
    const products: WooProduct[] = Array.from({ length: 40 }, (_, i) => ({ id: 100 + i, name: `Robe ${i}`, sizes }));
    servePages([products]);
    const s = await newShop();
    await importCatalog(deps, s.id);
    expect(variationRequests()).toHaveLength(WOO_VARIATION_REQUESTS);
    const notChecked = (await productsOf(s.id)).filter((p) => p.variantsCheckedAt === null);
    expect(notChecked).toHaveLength(10);

    // The next import reads those first (and the rest, read an hour ago, waits for its day).
    later(HOUR);
    await importCatalog(deps, s.id);
    expect(new Set(bulkParents())).toEqual(new Set(notChecked.map((p) => Number(p.externalId))));
    expect(variationRequests()).toHaveLength(10);
  }, 60_000);

  it("never skips a product too big for the budget: read in parts over imports with nothing else to read", async () => {
    const huge = Array.from({ length: (WOO_VARIATION_REQUESTS + 5) * 100 }, (_, i) => `T${i}`);
    servePages([
      [
        { id: 1, name: "Robe aux mille tailles", sizes: huge },
        { id: 2, name: "Jupe", sizes: ["S"] },
      ],
    ]);
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const s = await newShop();
      await importCatalog(deps, s.id);
      expect(bulkParents()).toEqual([2]);
      expect((await byExternalId(s.id, "1")).variantsCheckedAt).toBeNull();
      expect(log).toHaveBeenCalledWith(expect.stringContaining("product 1 (3500 variations) waits"));

      expect(log).toHaveBeenCalledWith(expect.stringContaining("product 1 (3500 variations) waits for its share"));

      // Nothing else to read: the budget goes to it, its pass goes on at the next import.
      later(HOUR);
      await importCatalog(deps, s.id);
      expect(bulkHits()).toHaveLength(WOO_VARIATION_REQUESTS);
      expect(await byExternalId(s.id, "1")).toMatchObject({ variantsCheckedAt: null, variantsCursor: 3000 });
      expect(log).toHaveBeenCalledWith(expect.stringContaining("product 1 (3500 variations) read in parts"));

      later(HOUR);
      await importCatalog(deps, s.id);
      expect(bulkHits().map((hit) => new URL(hit, "http://x").searchParams.get("page"))).toEqual([
        "31",
        "32",
        "33",
        "34",
        "35",
      ]);
      expect(await byExternalId(s.id, "1")).toMatchObject({ variantsCheckedAt: clock, variantsCursor: 0 });
    } finally {
      log.mockRestore();
    }
  }, 60_000);

  it("reads the variations one by one for a shop that refuses the listing (400), and remembers it", async () => {
    servePages([[{ id: 1, name: "Robe", sizes: ["S", "M"] }]], { outOfStock: [variationId(1, 1)] });
    bulkStatus = 400;
    const s = await newShop();
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await importCatalog(deps, s.id);
    log.mockRestore();
    expect(bulkHits()).toHaveLength(1);
    expect(oneByOneHits()).toEqual([`${API}/${variationId(1, 0)}`, `${API}/${variationId(1, 1)}`]);
    expect(await sizesOf((await byExternalId(s.id, "1")).id)).toEqual(["S", "M (épuisé)"]);
    expect((await shopRow(s.id))?.importHints).toEqual({ wooSingleSince: clock.toISOString() });

    // Next time: straight to one by one.
    servePages([[{ id: 1, name: "Robe", sizes: ["S", "M"], price: "3990" }]]);
    later(HOUR);
    await importCatalog(deps, s.id);
    expect(bulkHits()).toEqual([]);
    expect(oneByOneHits()).toHaveLength(2);
  });

  it("reads a site with plain permalinks under ?rest_route= once /wp-json/ answers 404, and remembers it", async () => {
    servePages([[{ id: 1, name: "Robe" }]], { plain: true });
    const s = await newShop();
    expect(await importCatalog(deps, s.id)).toMatchObject({ created: 1, error: null });
    expect(shop.hits.filter((h) => h !== "/robots.txt")).toEqual([pagePath(1), plainPagePath(1)]);
    expect((await shopRow(s.id))?.importHints).toEqual({ wooRoute: "plain" });

    later(HOUR);
    await importCatalog(deps, s.id);
    expect(shop.hits.filter((h) => h !== "/robots.txt")).toEqual([plainPagePath(1)]);
  });

  it("never reads under ?rest_route= what robots.txt forbids under /wp-json/", async () => {
    servePages([[{ id: 1, name: "Robe" }]], { plain: true });
    routes["/robots.txt"] = { headers: { "content-type": "text/plain" }, body: "User-agent: *\nDisallow: /wp-json/\n" };
    const s = await newShop({ importHints: { wooRoute: "plain" } });
    expect((await importCatalog(deps, s.id)).error).toBe("robots_disallowed");
    expect(shop.hits.filter((h) => h !== "/robots.txt")).toEqual([]);
  });

  it("stops with woocommerce_api_unavailable when the Store API answers at neither address, and crawls nothing else", async () => {
    const s = await newShop();
    expect((await importCatalog(deps, s.id)).error).toBe("woocommerce_api_unavailable");
    expect(shop.hits.filter((hit) => hit !== "/robots.txt")).toEqual([pagePath(1), plainPagePath(1)]);

    // A WordPress without the Store API: its home page under ?rest_route=.
    routes["/"] = { headers: { "content-type": "text/html" }, body: "<html>Accueil</html>" };
    expect((await importCatalog(deps, s.id)).error).toBe("woocommerce_api_unavailable");
    routes[pagePath(1)] = { headers: JSON_TYPE, body: JSON.stringify({ code: "rest_disabled" }) };
    expect((await importCatalog(deps, s.id)).error).toBe("woocommerce_api_unavailable");
    expect(await shopRow(s.id)).toMatchObject({ importState: null, lastImportError: "woocommerce_api_unavailable" });
  });

  it("takes a bot challenge where the JSON should be for a refusal (blocked), not a disabled API", async () => {
    const challenge = {
      headers: { "content-type": "text/html" },
      body: '<html><script src="/cdn-cgi/cf-chl/x.js"></script></html>',
    };
    routes[pagePath(1)] = challenge;
    routes["/"] = challenge;
    const s = await newShop();
    expect((await importCatalog(deps, s.id)).error).toBe("blocked (HTTP 200)");
    // The other address was tried once: the same challenge there.
    expect(shop.hits.filter((h) => h !== "/robots.txt")).toEqual([pagePath(1), plainPagePath(1)]);

    // A challenge on /wp-json/ only, nothing under ?rest_route=: still a refusal.
    delete routes["/"];
    expect((await importCatalog(deps, s.id)).error).toBe("blocked (HTTP 200)");
  });

  it("goes on to ?rest_route= when /wp-json/ answers the home page (plain permalinks behind nginx)", async () => {
    servePages([[{ id: 1, name: "Robe" }]], { plain: true });
    routes[pagePath(1)] = { headers: { "content-type": "text/html" }, body: "<html>Accueil de la boutique</html>" };
    const s = await newShop();
    expect(await importCatalog(deps, s.id)).toMatchObject({ created: 1, error: null });
    expect((await shopRow(s.id))?.importHints).toEqual({ wooRoute: "plain" });

    // The home page at both addresses (no Store API, no challenge): no Store API.
    const other = await newShop({ slug: `woo-home-${++counter}` });
    delete routes[plainPagePath(1)];
    routes["/"] = { headers: { "content-type": "text/html" }, body: "<html>Accueil de la boutique</html>" };
    expect((await importCatalog(deps, other.id)).error).toBe("woocommerce_api_unavailable");
  });

  it("takes an HTML page on a later page of the listing for a refusal", async () => {
    servePages(twoPages());
    routes[pagePath(2)] = { headers: { "content-type": "text/html" }, body: "<html>Un instant…</html>" };
    const s = await newShop();
    expect((await importCatalog(deps, s.id)).error).toBe("blocked (HTTP 200)");
  });

  it("applies robots.txt's query rules for /wp-json/ to ?rest_route= as well", async () => {
    servePages([[{ id: 1, name: "Robe" }]], { plain: true });
    routes["/robots.txt"] = {
      headers: { "content-type": "text/plain" },
      body: "User-agent: *\nDisallow: /wp-json/wc/store/v1/products?per_page=\n",
    };
    const s = await newShop({ importHints: { wooRoute: "plain" } });
    expect((await importCatalog(deps, s.id)).error).toBe("robots_disallowed");
    expect(shop.hits.filter((h) => h !== "/robots.txt")).toEqual([]);
  });

  it("takes a 400 or 404 past the first page of the variations listing for its end", async () => {
    const sizes = Array.from({ length: 100 }, (_, i) => `T${i}`);
    for (const status of [400, 404]) {
      later(0);
      // Its own product each time (another shop already has the first one's address).
      servePages([[{ id: status, name: "Robe", sizes }]]);
      bulkPastEnd = status;
      const s = await newShop();
      expect((await importCatalog(deps, s.id)).error).toBeNull();
      expect(bulkHits()).toHaveLength(2);
      const robe = await byExternalId(s.id, String(status));
      expect(robe).toMatchObject({ variantsCheckedAt: clock, variantsTriedAt: null });
      expect((await sizesOf(robe.id)).every((size) => !size.includes("épuisé"))).toBe(true);
    }
  });

  it("takes a 404 on a page the shop's own count announces for a failure, not the end of the listing", async () => {
    const sizes = Array.from({ length: 150 }, (_, i) => `T${i}`);
    servePages([[{ id: 3, name: "Robe", sizes }]]);
    // Two pages announced (x-wp-totalpages: 2), the second answers 404.
    bulkMissingPage = 2;
    const s = await newShop();
    expect((await importCatalog(deps, s.id)).error).toBeNull();
    expect(bulkHits()).toHaveLength(2);
    const robe = await byExternalId(s.id, "3");
    // Not read in full: its stock stays as it was, and it waits 24 h.
    expect(robe).toMatchObject({ variantsCheckedAt: null, variantsTriedAt: clock });
    expect((await sizesOf(robe.id)).every((size) => !size.includes("épuisé"))).toBe(true);
  });

  it("refused part-way (400 after earlier batches): one by one for the rest, the requests made counted in", async () => {
    const big = Array.from({ length: 100 }, (_, i) => `T${i}`);
    const twenty = Array.from({ length: 20 }, (_, i) => `T${i}`);
    servePages([
      [
        ...Array.from({ length: 25 }, (_, i) => ({ id: 100 + i, name: `Robe ${i}`, sizes: big })),
        ...Array.from({ length: 15 }, (_, i) => ({ id: 200 + i, name: `Jupe ${i}`, sizes: twenty })),
      ],
    ]);
    // 25 listing requests for the first batch, then the listing is refused.
    bulkRefusedFrom = 26;
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const s = await newShop();
      await importCatalog(deps, s.id);
      expect(bulkHits()).toHaveLength(26);
      // 300 in all: 26 listing requests, then 13 skirts of 20 variations (14 left: not enough for one more).
      expect(oneByOneHits()).toHaveLength(260);
      expect(variationRequests().length).toBeLessThanOrEqual(300);
      expect((await shopRow(s.id))?.importHints).toMatchObject({ wooSingleSince: clock.toISOString() });
    } finally {
      log.mockRestore();
    }
  }, 60_000);

  it("reads a big product one by one over several imports, from where it stopped", async () => {
    const sizes = Array.from({ length: 350 }, (_, i) => `T${i}`);
    servePages([[{ id: 1, name: "Robe", sizes }]]);
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const s = await newShop({ importHints: { wooSingleSince: clock.toISOString() } });
      await importCatalog(deps, s.id);
      expect(oneByOneHits()).toHaveLength(300);
      expect(await byExternalId(s.id, "1")).toMatchObject({ variantsCheckedAt: null, variantsCursor: 300 });

      later(HOUR);
      await importCatalog(deps, s.id);
      expect(oneByOneHits()).toEqual(sizes.slice(300).map((_, i) => `${API}/${variationId(1, 300 + i)}`));
      expect(await byExternalId(s.id, "1")).toMatchObject({ variantsCheckedAt: clock, variantsCursor: 0 });
    } finally {
      log.mockRestore();
    }
  }, 60_000);

  it("gives a big product waiting for a day half of the import's budget first, the rest to the others", async () => {
    const huge = Array.from({ length: (WOO_VARIATION_REQUESTS + 5) * 100 }, (_, i) => `T${i}`);
    servePages([
      [
        { id: 1, name: "Robe aux mille tailles", sizes: huge },
        { id: 2, name: "Jupe", sizes: ["S"] },
      ],
    ]);
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const s = await newShop();
      await importCatalog(deps, s.id);
      expect(bulkParents()).toEqual([2]);
      // A day later the skirt is due again, and the robe has waited a day: it goes first, with half of the budget;
      // the skirt is read with the other half, and what it leaves goes back to the robe.
      await handle.db
        .update(schema.products)
        .set({ createdAt: new Date(clock.getTime() - 2 * 24 * HOUR) })
        .where(eq(schema.products.shopId, s.id));
      later(25 * HOUR);
      await importCatalog(deps, s.id);
      const half = Math.floor(WOO_VARIATION_REQUESTS / 2);
      const rest = WOO_VARIATION_REQUESTS - half - 1;
      expect(bulkParents()).toEqual([
        ...Array.from({ length: half }, () => 1),
        2,
        ...Array.from({ length: rest }, () => 1),
      ]);
      expect(bulkHits()).toHaveLength(WOO_VARIATION_REQUESTS);
      expect(await byExternalId(s.id, "1")).toMatchObject({ variantsCursor: (half + rest) * 100 });
      expect(await byExternalId(s.id, "2")).toMatchObject({ variantsCheckedAt: clock });
      expect(log).toHaveBeenCalledWith(expect.stringContaining("product 1 (3500 variations) read first"));
    } finally {
      log.mockRestore();
    }
  }, 60_000);

  it("an overdue big product alone to read uses the whole budget", async () => {
    const huge = Array.from({ length: WOO_VARIATION_REQUESTS * 3 * 100 }, (_, i) => `T${i}`);
    servePages([[{ id: 1, name: "Robe aux mille tailles", sizes: huge }]]);
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const s = await newShop();
      await importCatalog(deps, s.id);
      expect(bulkHits()).toHaveLength(WOO_VARIATION_REQUESTS);
      await handle.db
        .update(schema.products)
        .set({ createdAt: new Date(clock.getTime() - 2 * 24 * HOUR) })
        .where(eq(schema.products.shopId, s.id));
      later(25 * HOUR);
      await importCatalog(deps, s.id);
      expect(log).toHaveBeenCalledWith(expect.stringContaining("product 1 (9000 variations) read first"));
      // Its half, then the half nobody else took: the whole budget, going on page after page.
      expect(bulkHits()).toHaveLength(WOO_VARIATION_REQUESTS);
      const pages = bulkHits().map((hit) => Number(new URL(hit, "http://x").searchParams.get("page")));
      expect(pages).toEqual(Array.from({ length: WOO_VARIATION_REQUESTS }, (_, i) => WOO_VARIATION_REQUESTS + 1 + i));
      expect(await byExternalId(s.id, "1")).toMatchObject({ variantsCursor: 2 * WOO_VARIATION_REQUESTS * 100 });
    } finally {
      log.mockRestore();
    }
  }, 60_000);

  it("keeps the last known stock of a variation listed in a shape it cannot read (never sold out)", async () => {
    servePages([[{ id: 1, name: "Robe", sizes: ["S", "M"] }]]);
    const s = await newShop();
    await importCatalog(deps, s.id);
    const robe = await byExternalId(s.id, "1");
    expect(await sizesOf(robe.id)).toEqual(["S", "M"]);

    servePages([[{ id: 1, name: "Robe", sizes: ["S", "M"], price: "3990" }]], { outOfStock: [variationId(1, 0)] });
    broken.add(variationId(1, 1));
    later(HOUR);
    await importCatalog(deps, s.id);
    expect(await sizesOf(robe.id)).toEqual(["S (épuisé)", "M"]);
  });

  it("stops reading variations at the first failure of the import, those products waiting 24 h", async () => {
    servePages([Array.from({ length: 60 }, (_, i) => ({ id: 100 + i, name: `Robe ${i}`, sizes: ["S", "M"] }))]);
    bulkStatus = 500;
    const s = await newShop();
    expect((await importCatalog(deps, s.id)).error).toBeNull();
    expect(bulkHits()).toHaveLength(1);
    const rows = await productsOf(s.id);
    expect(rows.filter((p) => p.variantsTriedAt !== null)).toHaveLength(25);
    expect(rows.filter((p) => p.variantsTriedAt === null && p.variantsCheckedAt === null)).toHaveLength(35);
  });

  it("counts and logs the listed products it could not read", async () => {
    servePages([[{ id: 1, name: "Robe" }]]);
    const page = JSON.parse(String(routes[pagePath(1)]?.body)) as unknown[];
    routes[pagePath(1)] = {
      headers: JSON_TYPE,
      body: JSON.stringify([...page, { id: 2, name: "Sans prix" }, "nonsense"]),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const s = await newShop();
      expect(await importCatalog(deps, s.id)).toMatchObject({ created: 1, skipped: 2, error: null });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("2 listed product(s) skipped"));
    } finally {
      warn.mockRestore();
    }
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
    later(HOUR);
    expect(await importCatalog(deps, s.id)).toMatchObject({ removed: 1, error: null });
    expect((await byExternalId(s.id, "1")).removedAt).toEqual(clock);
    expect((await byExternalId(s.id, "SKU-12")).removedAt).toBeNull();

    servePages([[{ id: 1000, name: "Article 0" }]]);
    later(HOUR);
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
      later(HOUR);
      expect((await importCatalog(deps, s.id)).error).toBe(`blocked (HTTP ${status})`);
      // No second try after a refusal, nor at the other address.
      expect(shop.hits.filter((h) => h !== "/robots.txt")).toEqual([pagePath(1)]);
      expect(await shopRow(s.id)).toMatchObject({ importState: null, lastImportError: `blocked (HTTP ${status})` });
      expect((await byExternalId(s.id, "1")).removedAt).toBeNull();
      expect(await readShopifySlowdown(handle.db, clock)).toBeNull();
    },
  );

  it("stops at a refused variations listing too, before any removal", async () => {
    servePages([[{ id: 1, name: "Robe", sizes: ["S", "M"] }]]);
    bulkStatus = 429;
    const s = await newShop();
    expect((await importCatalog(deps, s.id)).error).toBe("blocked (HTTP 429)");
    expect(bulkHits()).toHaveLength(1);
    expect((await shopRow(s.id))?.lastImportAt).toBeNull();
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
    later(HOUR);
    expect(await importCatalog(deps, s.id)).toMatchObject({ created: 0, updated: 0, unchanged: 1, error: null });
    const after = await byExternalId(s.id, "1");
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.lastCapturedAt).toEqual(clock);
  });

  it("dates nothing at the shop's first import (unknown), then dates a new product by the hour it was first seen", async () => {
    servePages([
      [
        { id: 1, name: "Robe" },
        { id: 2, name: "Jupe" },
      ],
    ]);
    const s = await newShop();
    await importCatalog(deps, s.id);
    for (const id of ["1", "2"]) {
      expect(await byExternalId(s.id, id)).toMatchObject({ publishedAt: null, publishedSource: "unknown" });
    }
    // The shop's own order (WooCommerce lists the newest first).
    expect((await byExternalId(s.id, "1")).shopRank).toBe(0);
    expect((await byExternalId(s.id, "2")).shopRank).toBe(1);

    // An hour later the shop puts a new product online, first of its listing.
    servePages([
      [
        { id: 3, name: "Pull" },
        { id: 1, name: "Robe" },
        { id: 2, name: "Jupe" },
      ],
    ]);
    later(HOUR);
    await importCatalog(deps, s.id);
    expect(await byExternalId(s.id, "3")).toMatchObject({
      publishedAt: clock,
      publishedSource: "first_seen",
      shopRank: 0,
    });
    // Unchanged, not written again: still undated, their place moved down by one.
    expect(await byExternalId(s.id, "1")).toMatchObject({ publishedAt: null, publishedSource: "unknown", shopRank: 1 });
    expect((await byExternalId(s.id, "2")).shopRank).toBe(2);
  });

  it("a first import cut short still leaves the products it read undated; a date set by the admin is never overwritten", async () => {
    servePages([[{ id: 1, name: "Robe" }]]);
    const s = await newShop();
    // A first import that did not finish (suspicious, interrupted…): no `last_import_at`, still the first one.
    await importCatalog(deps, s.id);
    await handle.db.update(schema.shops).set({ lastImportAt: null }).where(eq(schema.shops.id, s.id));
    servePages([
      [
        { id: 2, name: "Jupe" },
        { id: 1, name: "Robe" },
      ],
    ]);
    later(HOUR);
    await importCatalog(deps, s.id);
    expect(await byExternalId(s.id, "2")).toMatchObject({ publishedAt: null, publishedSource: "unknown" });

    const byHand = new Date("2026-11-01T00:00:00Z");
    const robe = await byExternalId(s.id, "1");
    await handle.db
      .update(schema.products)
      .set({ publishedAt: byHand, publishedSource: "admin" })
      .where(eq(schema.products.id, robe.id));
    // Its listing changes: written again in full, the date stays the admin's.
    servePages([
      [
        { id: 2, name: "Jupe" },
        { id: 1, name: "Robe", price: "3990" },
      ],
    ]);
    later(HOUR);
    await importCatalog(deps, s.id);
    expect(await byExternalId(s.id, "1")).toMatchObject({
      priceCents: 3990,
      publishedAt: byHand,
      publishedSource: "admin",
    });
  });

  it("dispatches by platform: Shopify through its own import, any other platform refused and recorded", async () => {
    const other = await newShop({ platform: "prestashop" });
    expect((await importCatalog(deps, other.id)).error).toBe("unsupported_platform");
    expect((await shopRow(other.id))?.lastImportError).toBe("unsupported_platform");
    routes["/products.json?limit=250&page=1"] = { headers: JSON_TYPE, body: JSON.stringify({ products: [] }) };
    const shopify = await newShop({ platform: "shopify" });
    // An empty Shopify listing: read, nothing removed.
    expect((await importCatalog(deps, shopify.id)).error).toBe("suspicious_shrink");
    expect(shop.hits).toContain("/products.json?limit=250&page=1");
    expect(lines.at(-1)).toEqual({ shopify: "low" });
  });
});
