import type dns from "node:dns";
import { and, createDb, eq, schema } from "@closyria/db";
import { memoryStore } from "@closyria/storage";
import { type FakeRoute, type FakeShop, startFakeShop } from "@closyria/testing";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AddressPolicy } from "../capture/address-policy";
import { createRobotsCache, safeRobotsFetcher } from "../capture/robots";
import { seedReference } from "../capture/seed-reference";
import { loopbackForTests } from "../capture/testing";
import { createThrottle } from "../capture/throttle";
import { type ImportDeps, importShopifyCatalog } from "./import-shopify";

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
const JSON_TYPE = { "content-type": "application/json; charset=utf-8" };

const loopbackOnly: AddressPolicy = Object.assign((ip: string): boolean => ip === "127.0.0.1" && loopbackForTests(ip), {
  anyPortOnLoopback: true as const,
});
const noDns = ((host: string, _options: unknown, callback: (error: Error | null, addresses: never[]) => void) => {
  callback(Object.assign(new Error(`no DNS in tests: ${host}`), { code: "ENOTFOUND" }), []);
}) as unknown as typeof dns.lookup;

let shop: FakeShop;
let cdn: FakeShop;
let routes: Record<string, FakeRoute>;
let cdnRoutes: Record<string, FakeRoute>;
let pauses: { ms: number; hitsBefore: string[] }[];
let deps: ImportDeps;

beforeEach(async () => {
  routes = {};
  cdnRoutes = {};
  shop = await startFakeShop(routes);
  // Photos come from Shopify's CDN, another host than the shop.
  cdn = await startFakeShop(cdnRoutes);
  pauses = [];
  deps = {
    db: handle.db,
    store: memoryStore(),
    policy: loopbackOnly,
    lookup: noDns,
    robots: createRobotsCache(safeRobotsFetcher(loopbackOnly), Date.now),
    throttle: createThrottle(0),
    sleep: async (ms) => {
      pauses.push({ ms, hitsBefore: [...shop.hits] });
    },
  };
});

afterEach(async () => {
  await shop.close();
  await cdn.close();
});

type FakeProduct = { id: number; title: string; type?: string; price?: string; color?: string; image?: boolean };

function shopifyProduct(p: FakeProduct) {
  if (p.image) cdnRoutes[`/img/${p.id}.png`] = { headers: { "content-type": "image/png" }, body: PNG };
  return {
    id: p.id,
    title: p.title,
    handle: `produit-${p.id}`,
    body_html: "<p>Belle pièce</p>",
    published_at: "2026-10-01T10:00:00Z",
    vendor: "Maison",
    product_type: p.type ?? "",
    tags: [],
    options: [
      { name: "Taille", position: 1, values: ["S", "M"] },
      ...(p.color ? [{ name: "Couleur", position: 2, values: [p.color] }] : []),
    ],
    variants: [
      { id: p.id * 10, option1: "S", available: true, price: p.price ?? "49.90", compare_at_price: null },
      { id: p.id * 10 + 1, option1: "M", available: false, price: p.price ?? "49.90", compare_at_price: null },
    ],
    images: p.image ? [{ src: `${cdn.origin}/img/${p.id}.png` }] : [],
  };
}

const pagePath = (page: number) => `/products.json?limit=250&page=${page}`;

function servePages(pages: FakeProduct[][], options: { delayMs?: number } = {}) {
  for (const key of Object.keys(routes)) if (key.startsWith("/products.json")) delete routes[key];
  pages.forEach((products, index) => {
    routes[pagePath(index + 1)] = {
      headers: JSON_TYPE,
      body: JSON.stringify({ products: products.map(shopifyProduct) }),
      ...(options.delayMs ? { delayMs: options.delayMs } : {}),
    };
  });
  // Past the last page Shopify answers an empty list.
  routes[pagePath(pages.length + 1)] = { headers: JSON_TYPE, body: JSON.stringify({ products: [] }) };
}

/** A full first page (250) then a short one. */
function twoPages(extra: FakeProduct[] = []): FakeProduct[][] {
  const first: FakeProduct[] = Array.from({ length: 250 }, (_, i) => ({ id: 1000 + i, title: `Article ${i}` }));
  return [first, extra];
}

async function newShop(over: Partial<typeof schema.shops.$inferInsert> = {}) {
  const n = ++counter;
  const [s] = await handle.db
    .insert(schema.shops)
    .values({
      name: `Import ${n}`,
      slug: `import-shop-${n}`,
      platform: "shopify",
      status: "published",
      importEnabled: true,
      testUrl: `${shop.origin}/products/test`,
      ...over,
    })
    .returning();
  if (!s) throw new Error("no shop");
  return s;
}

const productsOf = (shopId: string) =>
  handle.db.select().from(schema.products).where(eq(schema.products.shopId, shopId));
const byExternalId = async (shopId: string, externalId: string) => {
  const [p] = await handle.db
    .select()
    .from(schema.products)
    .where(and(eq(schema.products.shopId, shopId), eq(schema.products.externalId, externalId)));
  return p;
};
const shopRow = async (id: string) => (await handle.db.select().from(schema.shops).where(eq(schema.shops.id, id)))[0];
const pageHits = () => shop.hits.filter((hit) => hit.startsWith("/products.json"));

async function refId(table: typeof schema.categories | typeof schema.colors, slug: string) {
  const [row] = await handle.db.select({ id: table.id }).from(table).where(eq(table.slug, slug));
  if (!row) throw new Error(`no ${slug}`);
  return row.id;
}

async function wishOn(productId: string) {
  const n = ++counter;
  const userId = `import-user-${n}`;
  await handle.db.insert(schema.user).values({ id: userId, name: userId, email: `${userId}@example.test` });
  const [profile] = await handle.db
    .insert(schema.profiles)
    .values({ userId, name: "Moi", audience: "women", color: "plum" })
    .returning();
  const [item] = await handle.db
    .insert(schema.items)
    .values({ userId, profileId: profile?.id as string, productId })
    .returning();
  if (!item) throw new Error("no item");
  return item;
}

describe("importShopifyCatalog", () => {
  it("reads two pages with a 1 s pause, one request at a time, and writes classified products like a capture", async () => {
    servePages(
      twoPages([
        { id: 1, title: "Robe à carreaux", type: "Robe", color: "Bordeaux", image: true },
        { id: 2, title: "Pull col roulé", type: "Pull", price: "79.00" },
      ]),
    );
    const s = await newShop();

    const result = await importShopifyCatalog(deps, s.id);

    expect(result).toEqual({ created: 252, updated: 0, removed: 0, error: null });
    // Page 2 is short: no third request.
    expect(pageHits()).toEqual([pagePath(1), pagePath(2)]);
    expect(shop.hits.filter((hit) => hit !== "/robots.txt")).toEqual([pagePath(1), pagePath(2)]);
    expect(shop.maxInFlight).toBe(1);
    // One pause of 1 s, after page 1 and before page 2.
    expect(pauses.map((p) => p.ms)).toEqual([1000]);
    expect(pauses[0]?.hitsBefore).toContain(pagePath(1));
    expect(pauses[0]?.hitsBefore).not.toContain(pagePath(2));

    expect(await productsOf(s.id)).toHaveLength(252);
    const robe = await byExternalId(s.id, "1");
    expect(robe).toMatchObject({
      name: "Robe à carreaux",
      brand: "Maison",
      canonicalUrl: `${shop.origin}/products/produit-1`,
      priceCents: 4990,
      currency: "EUR",
      captureStatus: "ok",
      source: "captured",
      removedAt: null,
      categoryId: await refId(schema.categories, "robes"),
      colorId: await refId(schema.colors, "bordeaux"),
    });
    expect(robe?.lastCapturedAt).toBeInstanceOf(Date);
    const pull = await byExternalId(s.id, "2");
    expect(pull?.priceCents).toBe(7900);
    expect(pull?.categoryId).toBe(await refId(schema.categories, "pulls-gilets"));

    const sizes = await handle.db
      .select()
      .from(schema.productSizes)
      .where(eq(schema.productSizes.productId, robe?.id as string));
    expect(sizes.map((x) => [x.label, x.available])).toEqual([
      ["S", true],
      ["M", false],
    ]);
    const images = await handle.db
      .select()
      .from(schema.productImages)
      .where(eq(schema.productImages.productId, robe?.id as string));
    expect(images).toHaveLength(1);
    const history = await handle.db
      .select()
      .from(schema.productHistory)
      .where(eq(schema.productHistory.productId, robe?.id as string));
    expect(history).toHaveLength(1);

    const after = await shopRow(s.id);
    expect(after?.lastImportAt).toBeInstanceOf(Date);
    expect(after?.lastImportError).toBeNull();
  });

  it("marks a product gone from the shop as removed without touching wishes, updates prices, and brings it back", async () => {
    const s = await newShop();
    servePages([
      [
        { id: 1, title: "Robe", type: "Robe" },
        { id: 2, title: "Jupe", type: "Jupe" },
        { id: 3, title: "Chemise", type: "Chemise" },
      ],
    ]);
    await importShopifyCatalog(deps, s.id);
    const jupe = await byExternalId(s.id, "2");
    if (!jupe) throw new Error("no jupe");
    const wish = await wishOn(jupe.id);
    // A link pasted by someone, not in the shop's catalogue under that id: never marked removed.
    const [pasted] = await handle.db
      .insert(schema.products)
      .values({ shopId: s.id, canonicalUrl: `${shop.origin}/pages/lookbook`, name: "Lookbook" })
      .returning();

    servePages([
      [
        { id: 1, title: "Robe", type: "Robe", price: "39.90" },
        { id: 3, title: "Chemise", type: "Chemise" },
      ],
    ]);
    const second = await importShopifyCatalog(deps, s.id);

    expect(second).toEqual({ created: 0, updated: 2, removed: 1, error: null });
    expect((await byExternalId(s.id, "2"))?.removedAt).toBeInstanceOf(Date);
    expect((await byExternalId(s.id, "1"))?.removedAt).toBeNull();
    expect((await byExternalId(s.id, "1"))?.priceCents).toBe(3990);
    const [item] = await handle.db.select().from(schema.items).where(eq(schema.items.id, wish.id));
    expect(item).toMatchObject({ productId: jupe.id, stage: wish.stage, deletedAt: null });
    const [stillPasted] = await handle.db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, pasted?.id ?? ""));
    expect(stillPasted?.removedAt).toBeNull();
    // A price change adds a history point; an unchanged product does not.
    const historyOf = async (externalId: string) =>
      handle.db
        .select()
        .from(schema.productHistory)
        .where(eq(schema.productHistory.productId, (await byExternalId(s.id, externalId))?.id as string));
    expect(await historyOf("1")).toHaveLength(2);
    expect(await historyOf("3")).toHaveLength(1);

    servePages([
      [
        { id: 1, title: "Robe", type: "Robe", price: "39.90" },
        { id: 2, title: "Jupe", type: "Jupe" },
        { id: 3, title: "Chemise", type: "Chemise" },
      ],
    ]);
    const third = await importShopifyCatalog(deps, s.id);
    expect(third).toEqual({ created: 0, updated: 3, removed: 0, error: null });
    expect((await byExternalId(s.id, "2"))?.removedAt).toBeNull();
    expect(await productsOf(s.id)).toHaveLength(4);
  });

  it("updates a product first pasted by link (same Shopify id) instead of creating a second one", async () => {
    const s = await newShop();
    const [pasted] = await handle.db
      .insert(schema.products)
      .values({
        shopId: s.id,
        canonicalUrl: `${shop.origin}/collections/robes/products/produit-1`,
        name: "Robe",
        externalId: "1",
      })
      .returning();
    servePages([[{ id: 1, title: "Robe longue", type: "Robe", price: "59.00" }]]);

    expect(await importShopifyCatalog(deps, s.id)).toEqual({ created: 0, updated: 1, removed: 0, error: null });
    const rows = await productsOf(s.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: pasted?.id, name: "Robe longue", priceCents: 5900 });
  });

  it("never overwrites the admin's classification", async () => {
    const s = await newShop();
    const pulls = await refId(schema.categories, "pulls-gilets");
    const noir = await refId(schema.colors, "noir");
    await handle.db.insert(schema.products).values({
      shopId: s.id,
      canonicalUrl: `${shop.origin}/products/produit-1`,
      name: "Robe",
      externalId: "1",
      categoryId: pulls,
      colorId: noir,
      categorySource: "admin",
    });
    servePages([[{ id: 1, title: "Robe", type: "Robe", color: "Bordeaux" }]]);

    await importShopifyCatalog(deps, s.id);

    expect(await byExternalId(s.id, "1")).toMatchObject({ categoryId: pulls, colorId: noir, categorySource: "admin" });
  });

  it("stops at a 429, records the error and removes nothing", async () => {
    const s = await newShop();
    servePages([
      [
        { id: 1, title: "Robe" },
        { id: 2, title: "Jupe" },
      ],
    ]);
    await importShopifyCatalog(deps, s.id);

    servePages(twoPages());
    routes[pagePath(2)] = { status: 429, headers: JSON_TYPE, body: "{}" };
    const hitsBefore = pageHits().length;
    const result = await importShopifyCatalog(deps, s.id);

    expect(result.error).toBe("blocked (HTTP 429)");
    expect(result.removed).toBe(0);
    // No retry against a shop that refuses.
    expect(pageHits().slice(hitsBefore)).toEqual([pagePath(1), pagePath(2)]);
    expect((await byExternalId(s.id, "1"))?.removedAt).toBeNull();
    expect((await byExternalId(s.id, "2"))?.removedAt).toBeNull();
    const after = await shopRow(s.id);
    expect(after?.lastImportError).toBe("blocked (HTTP 429)");
  });

  it("does not request a page robots.txt forbids, and records the error", async () => {
    const s = await newShop();
    await handle.db.insert(schema.products).values({
      shopId: s.id,
      canonicalUrl: `${shop.origin}/products/produit-9`,
      name: "Robe",
      externalId: "9",
    });
    routes["/robots.txt"] = {
      headers: { "content-type": "text/plain" },
      body: "User-agent: *\nDisallow: /products.json\n",
    };
    servePages([[{ id: 1, title: "Robe" }]]);

    const result = await importShopifyCatalog(deps, s.id);

    expect(result).toEqual({ created: 0, updated: 0, removed: 0, error: "robots_disallowed" });
    expect(pageHits()).toEqual([]);
    expect((await byExternalId(s.id, "9"))?.removedAt).toBeNull();
    expect((await shopRow(s.id))?.lastImportError).toBe("robots_disallowed");
    expect((await shopRow(s.id))?.lastImportAt).toBeNull();
  });

  it("retries a server error once after a pause, then stops", async () => {
    const s = await newShop();
    routes[pagePath(1)] = { status: 503, headers: { "content-type": "text/plain" }, body: "down" };

    const result = await importShopifyCatalog(deps, s.id);

    expect(result.error).toBe("http_error (HTTP 503)");
    expect(pageHits()).toEqual([pagePath(1), pagePath(1)]);
    expect(pauses.map((p) => p.ms)).toEqual([1000]);
  });

  it("clears the previous error after a successful import", async () => {
    const s = await newShop({ lastImportError: "blocked (HTTP 429)" });
    servePages([[{ id: 1, title: "Robe" }]]);
    expect((await importShopifyCatalog(deps, s.id)).error).toBeNull();
    expect((await shopRow(s.id))?.lastImportError).toBeNull();
  });

  it("runs one import at a time for a shop", async () => {
    const s = await newShop();
    servePages([[{ id: 1, title: "Robe" }]], { delayMs: 100 });

    const [first, second] = await Promise.all([importShopifyCatalog(deps, s.id), importShopifyCatalog(deps, s.id)]);

    expect([first.error, second.error].sort()).toEqual([null, "already_running"].sort());
    expect(pageHits()).toEqual([pagePath(1)]);
    expect(shop.maxInFlight).toBe(1);
  });

  it("refuses a shop that is not on Shopify or has no address", async () => {
    const other = await newShop({ platform: "other" });
    expect((await importShopifyCatalog(deps, other.id)).error).toBe("not_shopify");
    const noAddress = await newShop({ testUrl: null });
    expect((await importShopifyCatalog(deps, noAddress.id)).error).toBe("no_address");
    expect(shop.hits).toEqual([]);
  });
});
