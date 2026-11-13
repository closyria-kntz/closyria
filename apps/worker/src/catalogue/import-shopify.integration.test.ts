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
import { abortRunningImports, type ImportDeps, importShopifyCatalog, settleRunningImports } from "./import-shopify";

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
const XML_TYPE = { "content-type": "application/xml; charset=utf-8" };

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

type FakeProduct = {
  id: number;
  title: string;
  type?: string;
  price?: string;
  color?: string;
  image?: boolean;
  /** Whether size M is in stock (S always is). */
  mAvailable?: boolean;
  /** Shopify's own `updated_at`: the import does not rely on it (a stock change may not move it). */
  updatedAt?: string;
};

function shopifyProduct(p: FakeProduct) {
  if (p.image) cdnRoutes[`/img/${p.id}.png`] = { headers: { "content-type": "image/png" }, body: PNG };
  return {
    id: p.id,
    title: p.title,
    handle: `produit-${p.id}`,
    body_html: "<p>Belle pièce</p>",
    published_at: "2026-10-01T10:00:00Z",
    ...(p.updatedAt ? { updated_at: p.updatedAt } : {}),
    vendor: "Maison",
    product_type: p.type ?? "",
    tags: [],
    options: [
      { name: "Taille", position: 1, values: ["S", "M"] },
      ...(p.color ? [{ name: "Couleur", position: 2, values: [p.color] }] : []),
    ],
    variants: [
      { id: p.id * 10, option1: "S", available: true, price: p.price ?? "49.90", compare_at_price: null },
      {
        id: p.id * 10 + 1,
        option1: "M",
        available: p.mAvailable ?? false,
        price: p.price ?? "49.90",
        compare_at_price: null,
      },
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

    expect(result).toEqual({ created: 252, updated: 0, unchanged: 0, removed: 0, error: null });
    // Page 2 is short: no third request.
    expect(pageHits()).toEqual([pagePath(1), pagePath(2)]);
    // The sitemap first (none here: no estimate), then the pages.
    expect(shop.hits.filter((hit) => hit !== "/robots.txt")).toEqual(["/sitemap.xml", pagePath(1), pagePath(2)]);
    expect(shop.maxInFlight).toBe(1);
    // A pause of 1 s between two requests: after the sitemap, then after page 1 and before page 2.
    expect(pauses.map((p) => p.ms)).toEqual([1000, 1000]);
    expect(pauses[0]?.hitsBefore).toContain("/sitemap.xml");
    expect(pauses[0]?.hitsBefore).not.toContain(pagePath(1));
    expect(pauses[1]?.hitsBefore).toContain(pagePath(1));
    expect(pauses[1]?.hitsBefore).not.toContain(pagePath(2));

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

  it("writes its progress after each page for the admin, then the counts of the finished import", async () => {
    servePages(twoPages([{ id: 1, title: "Robe" }]));
    // A state left by a dead job (« En attente » a day ago) is replaced at the start.
    const s = await newShop({ importState: "queued", importStartedAt: new Date(Date.now() - 86_400_000) });
    const during: unknown[] = [];
    deps.sleep = async () => {
      const row = await shopRow(s.id);
      during.push({ state: row?.importState, pages: row?.importPages, seen: row?.importSeen });
      expect(Date.now() - (row?.importStartedAt?.getTime() ?? 0)).toBeLessThan(60_000);
    };

    await importShopifyCatalog(deps, s.id);

    expect(during).toEqual([
      { state: "running", pages: 0, seen: 0 },
      { state: "running", pages: 1, seen: 250 },
    ]);
    expect(await shopRow(s.id)).toMatchObject({
      importState: null,
      importPages: 2,
      importSeen: 251,
      lastImportSeen: 251,
      lastImportCreated: 251,
      lastImportRemoved: 0,
      lastImportError: null,
    });

    // The next import counts what is new and what is gone.
    servePages(twoPages([{ id: 2, title: "Jupe" }]));
    await importShopifyCatalog(deps, s.id);
    expect(await shopRow(s.id)).toMatchObject({ importState: null, lastImportCreated: 1, lastImportRemoved: 1 });
  });

  it("clears « Import en cours » when the import stops on an error, and keeps the last counts", async () => {
    const s = await newShop({ lastImportSeen: 40, lastImportCreated: 4, lastImportRemoved: 1 });
    routes[pagePath(1)] = { status: 429, headers: JSON_TYPE, body: "{}" };
    await importShopifyCatalog(deps, s.id);
    expect(await shopRow(s.id)).toMatchObject({
      importState: null,
      lastImportError: "blocked (HTTP 429)",
      lastImportSeen: 40,
      lastImportCreated: 4,
      lastImportRemoved: 1,
    });
  });

  it("clears « En attente » of a merged, refused or non-Shopify shop it stops at, keeping the last import's figures", async () => {
    const target = await newShop();
    const last = { lastImportSeen: 40, lastImportCreated: 4, lastImportRemoved: 1, importPages: 2, importSeen: 40 };
    const queued = { importState: "queued", importStartedAt: new Date() };
    for (const values of [{ mergedIntoId: target.id }, { status: "refused" }, { platform: "other" }]) {
      const s = await newShop({ ...values, ...queued, ...last });
      expect((await importShopifyCatalog(deps, s.id)).error).not.toBeNull();
      expect(await shopRow(s.id)).toMatchObject({ importState: null, ...last });
    }
    expect(shop.hits).toEqual([]);
  });

  it("dates each product by the shop's put-online date, else its creation date at the shop", async () => {
    const s = await newShop();
    servePages([
      [
        { id: 1, title: "Robe" },
        { id: 2, title: "Jupe" },
      ],
    ]);
    const listing = JSON.parse(routes[pagePath(1)]?.body as string) as { products: Record<string, unknown>[] };
    const [first, second] = listing.products;
    if (!first || !second) throw new Error("no products");
    first.published_at = "2026-10-01T10:00:00Z";
    second.published_at = null;
    second.created_at = "2026-09-15T08:00:00Z";
    routes[pagePath(1)] = { headers: JSON_TYPE, body: JSON.stringify(listing) };

    await importShopifyCatalog(deps, s.id);

    expect((await byExternalId(s.id, "1"))?.publishedAt?.toISOString()).toBe("2026-10-01T10:00:00.000Z");
    expect((await byExternalId(s.id, "2"))?.publishedAt?.toISOString()).toBe("2026-09-15T08:00:00.000Z");
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

    // The shirt did not change: only its check date moves.
    expect(second).toEqual({ created: 0, updated: 1, unchanged: 1, removed: 1, error: null });
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
    expect(third).toEqual({ created: 0, updated: 1, unchanged: 2, removed: 0, error: null });
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

    expect(await importShopifyCatalog(deps, s.id)).toEqual({
      created: 0,
      updated: 1,
      unchanged: 0,
      removed: 0,
      error: null,
    });
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

  it("does not mark removed a product the shop still lists but the parser rejects", async () => {
    const s = await newShop();
    servePages([
      [
        { id: 1, title: "Robe" },
        { id: 2, title: "Jupe" },
      ],
    ]);
    await importShopifyCatalog(deps, s.id);
    const broken = { ...shopifyProduct({ id: 2, title: "Jupe" }), variants: [] };
    routes[pagePath(1)] = {
      headers: JSON_TYPE,
      body: JSON.stringify({ products: [shopifyProduct({ id: 1, title: "Robe" }), broken] }),
    };

    const result = await importShopifyCatalog(deps, s.id);

    expect(result).toEqual({ created: 0, updated: 0, unchanged: 1, removed: 0, error: null });
    expect((await byExternalId(s.id, "2"))?.removedAt).toBeNull();
  });

  it("removes nothing when the listing comes back empty or under half, and records suspicious_shrink", async () => {
    const s = await newShop();
    servePages([
      [
        { id: 1, title: "Robe" },
        { id: 2, title: "Jupe" },
        { id: 3, title: "Chemise" },
        { id: 4, title: "Pull" },
      ],
    ]);
    await importShopifyCatalog(deps, s.id);

    for (const listing of [[], [{ id: 1, title: "Robe" }]]) {
      servePages([listing]);
      const result = await importShopifyCatalog(deps, s.id);
      expect(result.error).toBe("suspicious_shrink");
      expect(result.removed).toBe(0);
      const rows = await productsOf(s.id);
      expect(rows.filter((p) => p.removedAt !== null)).toEqual([]);
      expect((await shopRow(s.id))?.lastImportError).toBe("suspicious_shrink");
    }
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

    expect(result).toEqual({ created: 0, updated: 0, unchanged: 0, removed: 0, error: "robots_disallowed" });
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
    // After the sitemap, then before the retry.
    expect(pauses.map((p) => p.ms)).toEqual([1000, 1000]);
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
    expect((await shopRow(s.id))?.importState).toBeNull();
    expect(pageHits()).toEqual([pagePath(1)]);
    expect(shop.maxInFlight).toBe(1);
  });

  it("refuses a shop that is not on Shopify or has no address", async () => {
    const other = await newShop({ platform: "other" });
    expect((await importShopifyCatalog(deps, other.id)).error).toBe("not_shopify");
    const noAddress = await newShop({ testUrl: null });
    expect((await importShopifyCatalog(deps, noAddress.id)).error).toBe("no_address");
    expect((await shopRow(noAddress.id))?.lastImportError).toBe("no_address");
    expect(shop.hits).toEqual([]);
  });

  it("stops before any request or write for a merged or refused shop, and still imports a pending or draft one", async () => {
    servePages([[{ id: 1, title: "Robe" }]]);
    const target = await newShop();
    const merged = await newShop({ mergedIntoId: target.id });
    const refused = await newShop({ status: "refused" });
    for (const [s, reason] of [
      [merged, "merged"],
      [refused, "refused"],
    ] as const) {
      expect((await importShopifyCatalog(deps, s.id)).error).toBe(reason);
      expect(await productsOf(s.id)).toEqual([]);
      expect(await shopRow(s.id)).toEqual(s);
    }
    expect(shop.hits).toEqual([]);

    for (const [i, status] of (["pending", "draft"] as const).entries()) {
      // One fake shop serves both: distinct products, or they would share their address.
      servePages([[{ id: 10 + i, title: "Robe" }]]);
      const preview = await newShop({ status });
      expect((await importShopifyCatalog(deps, preview.id)).error).toBeNull();
      expect(await productsOf(preview.id)).toHaveLength(1);
    }
  });
  describe("estimated total from the sitemap", () => {
    const index = (paths: string[]) =>
      `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths
        .map((path) => `<sitemap><loc>${shop.origin}${path.replaceAll("&", "&amp;")}</loc></sitemap>`)
        .join("")}</sitemapindex>`;
    const urlset = (paths: string[]) =>
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths
        .map((path) => `<url><loc>${shop.origin}${path}</loc></url>`)
        .join("")}</urlset>`;

    it("counts the products of every products sitemap of the index, 1 s apart, before the first page", async () => {
      routes["/sitemap.xml"] = {
        headers: XML_TYPE,
        body: index(["/sitemap_products_1.xml?from=1&to=99", "/sitemap_pages_1.xml", "/sitemap_products_2.xml"]),
      };
      // Shopify lists the home page first in its first products sitemap: not a product.
      routes["/sitemap_products_1.xml?from=1&to=99"] = {
        headers: XML_TYPE,
        body: urlset(["/", "/products/a", "/products/b", "/products/c"]),
      };
      routes["/sitemap_products_2.xml"] = { headers: XML_TYPE, body: urlset(["/products/d", "/products/e"]) };
      routes["/sitemap_pages_1.xml"] = { headers: XML_TYPE, body: urlset(["/pages/contact"]) };
      servePages([[{ id: 1, title: "Robe" }]]);
      const s = await newShop({ importExpected: 999 });
      const atFirstPage: unknown[] = [];
      deps.sleep = async (ms) => {
        pauses.push({ ms, hitsBefore: [...shop.hits] });
        if (shop.hits.includes("/sitemap_products_2.xml")) atFirstPage.push((await shopRow(s.id))?.importExpected);
      };

      const result = await importShopifyCatalog(deps, s.id);

      expect(result).toEqual({ created: 1, updated: 0, unchanged: 0, removed: 0, error: null });
      expect(shop.hits.filter((hit) => hit !== "/robots.txt")).toEqual([
        "/sitemap.xml",
        "/sitemap_products_1.xml?from=1&to=99",
        "/sitemap_products_2.xml",
        pagePath(1),
      ]);
      expect(pauses.map((p) => p.ms)).toEqual([1000, 1000, 1000]);
      expect(shop.maxInFlight).toBe(1);
      // Written before the first page, so the bar has its scale from the start.
      expect(atFirstPage).toEqual([5]);
      expect(await shopRow(s.id)).toMatchObject({ importExpected: 5, lastImportError: null, lastImportSeen: 1 });
    });

    it("gives no estimate when robots.txt forbids the sitemap, and the import goes on unaffected", async () => {
      routes["/robots.txt"] = {
        headers: { "content-type": "text/plain" },
        body: "User-agent: *\nDisallow: /sitemap\n",
      };
      routes["/sitemap.xml"] = { headers: XML_TYPE, body: index(["/sitemap_products_1.xml"]) };
      servePages(twoPages());
      const s = await newShop({ importExpected: 999 });

      const result = await importShopifyCatalog(deps, s.id);

      expect(result).toEqual({ created: 250, updated: 0, unchanged: 0, removed: 0, error: null });
      expect(shop.hits.filter((hit) => hit.startsWith("/sitemap"))).toEqual([]);
      // No request before page 1: no pause either.
      expect(pauses.map((p) => p.ms)).toEqual([1000]);
      expect(await shopRow(s.id)).toMatchObject({ importExpected: null, lastImportError: null, lastImportSeen: 250 });
    });

    it("gives no estimate for a sitemap that is not one, too big or empty of products, without an import error", async () => {
      const cases: Record<string, FakeRoute>[] = [
        { "/sitemap.xml": { headers: { "content-type": "text/html" }, body: "<html>Oups</html>" } },
        { "/sitemap.xml": { headers: XML_TYPE, body: "<sitemapindex><sitemap><loc>broken" } },
        {
          "/sitemap.xml": { headers: XML_TYPE, body: index(["/sitemap_products_1.xml"]) },
          "/sitemap_products_1.xml": { headers: XML_TYPE, body: urlset(["/"]) },
        },
        {
          "/sitemap.xml": { headers: XML_TYPE, body: index(["/sitemap_products_1.xml"]) },
          "/sitemap_products_1.xml": { status: 429, headers: XML_TYPE, body: "" },
        },
        {
          "/sitemap.xml": { headers: XML_TYPE, body: index(["/sitemap_products_1.xml"]) },
          "/sitemap_products_1.xml": { headers: XML_TYPE, body: urlset(["/products/a".padEnd(21 * 1024 * 1024, "a")]) },
        },
      ];
      for (const [i, extra] of cases.entries()) {
        for (const key of Object.keys(routes)) if (key.startsWith("/sitemap")) delete routes[key];
        Object.assign(routes, extra);
        servePages([[{ id: 20 + i, title: "Robe" }]]);
        const s = await newShop();
        expect((await importShopifyCatalog(deps, s.id)).error, `case ${i}`).toBeNull();
        expect(await shopRow(s.id), `case ${i}`).toMatchObject({ importExpected: null, lastImportError: null });
      }
    });

    it("ignores a products sitemap on another site", async () => {
      routes["/sitemap.xml"] = {
        headers: XML_TYPE,
        body: `<sitemapindex><sitemap><loc>https://ailleurs.example/sitemap_products_1.xml</loc></sitemap></sitemapindex>`,
      };
      servePages([[{ id: 30, title: "Robe" }]]);
      const s = await newShop();
      await importShopifyCatalog(deps, s.id);
      expect((await shopRow(s.id))?.importExpected).toBeNull();
      expect(shop.hits.filter((hit) => hit.startsWith("/sitemap"))).toEqual(["/sitemap.xml"]);
    });
  });

  describe("heartbeat and interruption", () => {
    it("beats at its start and after each page", async () => {
      servePages(twoPages());
      const s = await newShop({ importHeartbeatAt: new Date(Date.now() - 86_400_000) });
      const beats: (Date | null | undefined)[] = [];
      deps.sleep = async () => {
        beats.push((await shopRow(s.id))?.importHeartbeatAt);
      };
      const start = Date.now();
      await importShopifyCatalog(deps, s.id);
      // Before page 1 (after the sitemap), then after page 1.
      expect(beats).toHaveLength(2);
      for (const beat of beats) expect(beat?.getTime()).toBeGreaterThanOrEqual(start - 1000);
      expect((await shopRow(s.id))?.importHeartbeatAt?.getTime()).toBeGreaterThanOrEqual(beats[1]?.getTime() ?? 0);
    });

    it("stops between pages when its signal is aborted, records the interruption, clears its state, removes nothing", async () => {
      const s = await newShop({ lastImportSeen: 40, lastImportCreated: 4, lastImportRemoved: 1 });
      await handle.db.insert(schema.products).values({
        shopId: s.id,
        canonicalUrl: `${shop.origin}/products/produit-9`,
        name: "Ancienne",
        externalId: "9",
      });
      servePages(twoPages());
      const controller = new AbortController();
      deps.sleep = async () => {
        if (shop.hits.includes(pagePath(1))) controller.abort();
      };

      const result = await importShopifyCatalog(deps, s.id, { signal: controller.signal });

      expect(result).toMatchObject({ created: 250, removed: 0, error: "interrupted" });
      expect(pageHits()).toEqual([pagePath(1)]);
      expect((await byExternalId(s.id, "9"))?.removedAt).toBeNull();
      expect(await shopRow(s.id)).toMatchObject({
        importState: null,
        lastImportError: "interrupted",
        lastImportSeen: 40,
        lastImportCreated: 4,
        lastImportRemoved: 1,
      });
    });

    it("stops within a page too, before the next product", async () => {
      servePages([Array.from({ length: 5 }, (_, i) => ({ id: 40 + i, title: `Article ${i}`, image: true }))]);
      // Each photo takes 200 ms: the abort lands while the first product's photo is being copied.
      for (const route of Object.values(cdnRoutes)) route.delayMs = 200;
      const s = await newShop();
      const controller = new AbortController();
      const timer = setInterval(() => {
        if (cdn.hits.length > 0) controller.abort();
      }, 5);
      try {
        const result = await importShopifyCatalog(deps, s.id, { signal: controller.signal });
        expect(result.error).toBe("interrupted");
        expect(await productsOf(s.id)).toHaveLength(1);
      } finally {
        clearInterval(timer);
      }
    });

    it("abortRunningImports stops every import of the process; settleRunningImports waits for their end", async () => {
      servePages(twoPages(), { delayMs: 50 });
      const s = await newShop();
      let release: () => void = () => {};
      const paused = new Promise<void>((resolve) => {
        release = resolve;
      });
      deps.sleep = async () => {
        if (shop.hits.includes(pagePath(1))) release();
      };
      const running = importShopifyCatalog(deps, s.id);
      await paused;
      abortRunningImports();
      expect(await settleRunningImports(5000)).toBe(true);
      expect((await running).error).toBe("interrupted");
      expect((await shopRow(s.id))?.importState).toBeNull();
      expect(pageHits()).toEqual([pagePath(1)]);
      // Nothing left to wait for.
      expect(await settleRunningImports(10)).toBe(true);
    });
  });
  describe("re-import of an unchanged catalogue", () => {
    const T1 = "2026-10-02T10:00:00.000Z";
    const DAY = 86_400_000;
    const catalogue = (over: Partial<Record<number, Partial<FakeProduct>>> = {}): FakeProduct[] =>
      [
        { id: 1, title: "Robe", type: "Robe", image: true, updatedAt: T1 },
        { id: 2, title: "Jupe", type: "Jupe", updatedAt: T1 },
        { id: 3, title: "Chemise", type: "Chemise", updatedAt: T1 },
      ].map((p) => ({ ...p, ...over[p.id] }));
    const snapshot = async (shopId: string) => {
      const rows = await productsOf(shopId);
      return Object.fromEntries(
        rows.map((p) => [
          p.externalId,
          { updatedAt: p.updatedAt.toISOString(), captured: p.lastCapturedAt?.toISOString() },
        ]),
      );
    };
    const historyCount = async (shopId: string) => {
      const ids = (await productsOf(shopId)).map((p) => p.id);
      const rows = await handle.db.select().from(schema.productHistory);
      return rows.filter((h) => ids.includes(h.productId)).length;
    };
    const sizesOf = async (productId: string) =>
      (await handle.db.select().from(schema.productSizes).where(eq(schema.productSizes.productId, productId)))
        .map((x) => [x.label, x.available])
        .sort();
    /** The import runs `days` later than now (the 7-day check). */
    const later = (days: number) => {
      deps.now = () => new Date(Date.now() + days * DAY);
    };

    it("writes nothing but the check date for products whose content did not change", async () => {
      const s = await newShop();
      servePages([catalogue()]);
      await importShopifyCatalog(deps, s.id);
      expect((await byExternalId(s.id, "1"))?.sourceHash).toMatch(/^[0-9a-f]{64}$/);
      const before = await snapshot(s.id);
      const historyBefore = await historyCount(s.id);
      const cdnHitsBefore = cdn.hits.length;

      later(1);
      const second = await importShopifyCatalog(deps, s.id);

      expect(second).toEqual({ created: 0, updated: 0, unchanged: 3, removed: 0, error: null });
      const after = await snapshot(s.id);
      for (const id of ["1", "2", "3"]) {
        // The row itself is untouched; only the check date moves (« Mis à jour le », capture freshness).
        expect(after[id]?.updatedAt).toBe(before[id]?.updatedAt);
        expect(Date.parse(after[id]?.captured ?? "")).toBeGreaterThan(Date.parse(before[id]?.captured ?? ""));
      }
      expect(await historyCount(s.id)).toBe(historyBefore);
      expect(cdn.hits.length).toBe(cdnHitsBefore);
      // Still counted as read: the « Terminé » line and the next progress bar are unchanged.
      expect(await shopRow(s.id)).toMatchObject({
        importState: null,
        importSeen: 3,
        lastImportSeen: 3,
        lastImportCreated: 0,
        lastImportRemoved: 0,
        lastImportError: null,
      });
    });

    it("rewrites a product whose price changed, and only that one", async () => {
      const s = await newShop();
      servePages([catalogue()]);
      await importShopifyCatalog(deps, s.id);
      const before = await snapshot(s.id);

      servePages([catalogue({ 2: { price: "39.90" } })]);
      const second = await importShopifyCatalog(deps, s.id);

      expect(second).toEqual({ created: 0, updated: 1, unchanged: 2, removed: 0, error: null });
      expect((await byExternalId(s.id, "2"))?.priceCents).toBe(3990);
      const after = await snapshot(s.id);
      expect(after["1"]?.updatedAt).toEqual(before["1"]?.updatedAt);
      expect(after["3"]?.updatedAt).toEqual(before["3"]?.updatedAt);
      expect(after["2"]?.updatedAt).not.toEqual(before["2"]?.updatedAt);
    });

    it("rewrites a product when one size comes back in stock, even with the same Shopify date", async () => {
      const s = await newShop();
      servePages([catalogue()]);
      await importShopifyCatalog(deps, s.id);
      const jupe = await byExternalId(s.id, "2");
      expect(await sizesOf(jupe?.id as string)).toEqual([
        ["M", false],
        ["S", true],
      ]);

      servePages([catalogue({ 2: { mAvailable: true } })]);
      const second = await importShopifyCatalog(deps, s.id);

      expect(second).toEqual({ created: 0, updated: 1, unchanged: 2, removed: 0, error: null });
      expect(await sizesOf(jupe?.id as string)).toEqual([
        ["M", true],
        ["S", true],
      ]);
    });

    it("rewrites every product when the admin changes the shop's listing kind", async () => {
      const s = await newShop();
      servePages([catalogue()]);
      await importShopifyCatalog(deps, s.id);
      await handle.db.update(schema.shops).set({ listingKind: "secondhand" }).where(eq(schema.shops.id, s.id));

      const second = await importShopifyCatalog(deps, s.id);

      expect(second).toEqual({ created: 0, updated: 3, unchanged: 0, removed: 0, error: null });
      // Second-hand: no sizes kept.
      expect(await sizesOf((await byExternalId(s.id, "2"))?.id as string)).toEqual([]);
    });

    it("rewrites a product checked more than 7 days ago, even unchanged (classification rules reach it)", async () => {
      const s = await newShop();
      servePages([catalogue()]);
      await importShopifyCatalog(deps, s.id);

      later(6);
      expect((await importShopifyCatalog(deps, s.id)).unchanged).toBe(3);
      // The skip at day 6 moved the check date: 7 days after it, not after the first write.
      later(12);
      expect((await importShopifyCatalog(deps, s.id)).unchanged).toBe(3);
      later(20);
      expect(await importShopifyCatalog(deps, s.id)).toEqual({
        created: 0,
        updated: 3,
        unchanged: 0,
        removed: 0,
        error: null,
      });
    });

    it("rewrites a product a capture found gone (404) when the listing still has it, clearing removed_at", async () => {
      const s = await newShop();
      servePages([catalogue()]);
      await importShopifyCatalog(deps, s.id);
      const at = new Date();
      await handle.db
        .update(schema.products)
        .set({ removedAt: at, updatedAt: at })
        .where(and(eq(schema.products.shopId, s.id), eq(schema.products.externalId, "2")));

      const second = await importShopifyCatalog(deps, s.id);

      expect(second).toEqual({ created: 0, updated: 1, unchanged: 2, removed: 0, error: null });
      expect((await byExternalId(s.id, "2"))?.removedAt).toBeNull();
    });

    it("rewrites a removed product that comes back with the same content, clearing removed_at", async () => {
      const s = await newShop();
      servePages([catalogue()]);
      await importShopifyCatalog(deps, s.id);
      servePages([catalogue().filter((p) => p.id !== 2)]);
      expect(await importShopifyCatalog(deps, s.id)).toEqual({
        created: 0,
        updated: 0,
        unchanged: 2,
        removed: 1,
        error: null,
      });
      expect((await byExternalId(s.id, "2"))?.removedAt).toBeInstanceOf(Date);

      servePages([catalogue()]);
      const third = await importShopifyCatalog(deps, s.id);

      expect(third).toEqual({ created: 0, updated: 1, unchanged: 2, removed: 0, error: null });
      expect((await byExternalId(s.id, "2"))?.removedAt).toBeNull();
      expect(await shopRow(s.id)).toMatchObject({ lastImportSeen: 3, lastImportRemoved: 0 });
    });

    it("keeps the removal guard: skipped products count as listed, a short listing still removes nothing", async () => {
      const s = await newShop();
      const many = Array.from({ length: 6 }, (_, i) => ({ id: 20 + i, title: `Article ${i}` }));
      servePages([many]);
      await importShopifyCatalog(deps, s.id);

      servePages([many.slice(0, 2)]);
      const shrink = await importShopifyCatalog(deps, s.id);
      expect(shrink).toMatchObject({ unchanged: 2, removed: 0, error: "suspicious_shrink" });
      expect((await productsOf(s.id)).filter((p) => p.removedAt !== null)).toEqual([]);

      servePages([many.slice(0, 5)]);
      const normal = await importShopifyCatalog(deps, s.id);
      expect(normal).toEqual({ created: 0, updated: 0, unchanged: 5, removed: 1, error: null });
      expect((await byExternalId(s.id, "25"))?.removedAt).toBeInstanceOf(Date);
      expect((await byExternalId(s.id, "24"))?.removedAt).toBeNull();
    });

    it("never skips a product whose photo could not be copied: the next import retries it", async () => {
      const s = await newShop();
      servePages([[{ id: 2, title: "Jupe", image: true }]]);
      cdnRoutes["/img/2.png"] = { status: 503, headers: { "content-type": "text/plain" }, body: "down" };
      await importShopifyCatalog(deps, s.id);
      expect((await byExternalId(s.id, "2"))?.sourceHash).toBeNull();

      cdnRoutes["/img/2.png"] = { headers: { "content-type": "image/png" }, body: PNG };
      const second = await importShopifyCatalog(deps, s.id);
      expect(second).toEqual({ created: 0, updated: 1, unchanged: 0, removed: 0, error: null });
      const jupe = await byExternalId(s.id, "2");
      expect(jupe?.sourceHash).not.toBeNull();
      const images = await handle.db
        .select()
        .from(schema.productImages)
        .where(eq(schema.productImages.productId, jupe?.id as string));
      expect(images).toHaveLength(1);
      expect((await importShopifyCatalog(deps, s.id)).unchanged).toBe(1);
    });

    it("leaves the admin's classification alone on a rewrite", async () => {
      const s = await newShop();
      servePages([catalogue()]);
      await importShopifyCatalog(deps, s.id);
      const pulls = await refId(schema.categories, "pulls-gilets");
      await handle.db
        .update(schema.products)
        .set({ categoryId: pulls, categorySource: "admin" })
        .where(and(eq(schema.products.shopId, s.id), eq(schema.products.externalId, "1")));

      servePages([catalogue({ 1: { price: "59.00" } })]);
      expect((await importShopifyCatalog(deps, s.id)).updated).toBe(1);
      expect(await byExternalId(s.id, "1")).toMatchObject({ categoryId: pulls, categorySource: "admin" });
    });
  });
});
