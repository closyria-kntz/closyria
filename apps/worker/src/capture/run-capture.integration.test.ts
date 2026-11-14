import type dns from "node:dns";
import { readFileSync } from "node:fs";
import { createDb, eq, schema } from "@closyria/db";
import { canonicalizeUrl } from "@closyria/shared";
import { memoryStore } from "@closyria/storage";
import { type FakeRoute, type FakeShop, startFakeShop } from "@closyria/testing";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressPolicy } from "./address-policy";
import { createRobotsCache, safeRobotsFetcher } from "./robots";
import { type CaptureDeps, runCapture } from "./run-capture";
import { seedReference } from "./seed-reference";
import { loopbackForTests } from "./testing";
import { createThrottle } from "./throttle";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let handle: ReturnType<typeof createDb>;
let counter = 0;

beforeAll(async () => {
  database = await createTestDatabase();
  handle = createDb(database.url, { max: 4 });
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
const fixture = (file: string) =>
  readFileSync(new URL(`../../../../packages/extract/fixtures/${file}`, import.meta.url));

/** Loopback only: a test that reaches for the Internet (a photo address left unrewritten) fails instead. */
const loopbackOnly: AddressPolicy = Object.assign((ip: string): boolean => ip === "127.0.0.1" && loopbackForTests(ip), {
  anyPortOnLoopback: true as const,
});

/** No DNS in tests: every hostname fails (the fake shop is an IP literal and never gets here). */
const noDns = ((host: string, _options: unknown, callback: (error: Error | null, addresses: never[]) => void) => {
  callback(Object.assign(new Error(`no DNS in tests: ${host}`), { code: "ENOTFOUND" }), []);
}) as unknown as typeof dns.lookup;

const EXPECTED_ZALANDO_PHOTOS = 6;

let shop: FakeShop;
let routes: Record<string, FakeRoute>;
let store: ReturnType<typeof memoryStore>;
let deps: CaptureDeps;

/** Points every image address of a recorded page at the fake shop (the recordings reference real CDNs). */
function localImages(text: string, origin: string): string {
  const seen = new Map<string, number>();
  // JSON recordings escape slashes (`\/\/cdn…`); unescaped they are still valid JSON.
  return text
    .replaceAll("\\/", "/")
    .replace(/(?:https?:)?\/\/(?!127\.0\.0\.1|schema\.org|www\.w3\.org)[^"'\s<>\\]+/g, (match) => {
      if (!seen.has(match)) seen.set(match, seen.size);
      const path = `/img/${seen.get(match)}.png`;
      routes[path] = { headers: { "content-type": "image/png" }, body: PNG };
      return `${origin}${path}`;
    });
}

beforeEach(async () => {
  routes = {};
  shop = await startFakeShop(routes);
  store = memoryStore();
  deps = {
    db: handle.db,
    store,
    policy: loopbackOnly,
    lookup: noDns,
    robots: createRobotsCache(safeRobotsFetcher(loopbackOnly), Date.now),
    throttle: createThrottle(0),
  };
});

afterEach(() => shop.close());

function servePage(path: string, file: string) {
  routes[path] = {
    headers: { "content-type": "text/html; charset=utf-8" },
    body: localImages(fixture(file).toString("utf8"), shop.origin),
  };
}

function serveJs(path: string, file: string) {
  routes[path] = {
    headers: { "content-type": "application/json; charset=utf-8" },
    body: localImages(fixture(file).toString("utf8"), shop.origin),
  };
}

async function setup(
  path: string,
  options: {
    shop?: Partial<typeof schema.shops.$inferInsert>;
    product?: Partial<typeof schema.products.$inferInsert>;
  } = {},
  trigger: "user" | "admin_test" | "monitor" | "refresh" = "user",
) {
  const n = ++counter;
  const [s] = await handle.db
    .insert(schema.shops)
    .values({ name: `Shop ${n}`, slug: `capture-shop-${n}`, ...options.shop })
    .returning();
  if (!s) throw new Error("no shop");
  const url = `${shop.origin}${path}`;
  const [p] = await handle.db
    .insert(schema.products)
    .values({
      shopId: s.id,
      canonicalUrl: `${url}?n=${n}`,
      name: "Robe",
      currency: "EUR",
      priceCents: 1,
      ...options.product,
    })
    .returning();
  if (!p) throw new Error("no product");
  const capture = await newCapture(s.id, p.id, url, trigger);
  return { shop: s, product: p, url, capture };
}

async function newCapture(
  shopId: string,
  productId: string | null,
  url: string,
  trigger: "user" | "admin_test" | "monitor" | "refresh",
) {
  const [c] = await handle.db.insert(schema.captures).values({ shopId, productId, url, trigger }).returning();
  if (!c) throw new Error("no capture");
  return c;
}

async function load(captureId: string, productId: string) {
  const [capture] = await handle.db.select().from(schema.captures).where(eq(schema.captures.id, captureId));
  const [product] = await handle.db.select().from(schema.products).where(eq(schema.products.id, productId));
  const sizes = await handle.db.select().from(schema.productSizes).where(eq(schema.productSizes.productId, productId));
  const history = await handle.db
    .select()
    .from(schema.productHistory)
    .where(eq(schema.productHistory.productId, productId));
  const images = await handle.db
    .select()
    .from(schema.productImages)
    .where(eq(schema.productImages.productId, productId));
  return { capture, product, sizes, history, images };
}

async function newUser(): Promise<string> {
  const n = ++counter;
  const [user] = await handle.db
    .insert(schema.user)
    .values({ id: `capture-user-${n}`, name: `User ${n}`, email: `capture-${n}@example.test` })
    .returning();
  if (!user) throw new Error("no user");
  return user.id;
}

const imageHits = () => shop.hits.filter((hit) => hit.startsWith("/img/"));

describe("runCapture", () => {
  it("captures a Shopify product from its .js, with sizes, history and WebP photos", async () => {
    serveJs("/products/produit-3679.js", "real/mcb-paris.js.json");
    const t = await setup("/products/produit-3679", { shop: { platform: "shopify" } });

    await runCapture(t.capture.id, deps);

    const r = await load(t.capture.id, t.product.id);
    expect(r.capture?.status).toBe("succeeded");
    expect(r.capture?.method).toBe("shopify");
    expect(r.capture?.httpStatus).toBe(200);
    expect(r.capture?.dataReady).toBe(true);
    expect(r.capture?.finishedAt).toBeInstanceOf(Date);
    expect(r.capture?.durationMs).toBeGreaterThanOrEqual(0);
    expect(r.product?.name).toBe("PANTALON LEONIE");
    expect(r.product?.captureStatus).toBe("ok");
    expect(r.product?.source).toBe("captured");
    expect(r.product?.lastCapturedAt).toBeInstanceOf(Date);
    expect(r.sizes.length).toBeGreaterThan(0);
    expect(r.history).toHaveLength(1);
    expect(r.images).toHaveLength(5);
    expect(r.images.map((i) => i.position).sort()).toEqual([0, 1, 2, 3, 4]);
    for (const image of r.images) {
      expect(image.key).toBe(`products/${t.product.id}/${image.sourceHash}.webp`);
      expect((await store.get(image.key)).subarray(8, 12).toString("ascii")).toBe("WEBP");
    }
    // Shopify shop: the .js only, the HTML page is never requested.
    expect(shop.hits).not.toContain("/products/produit-3679");
  });

  it("reads the page, then the .js of an unknown shop whose page is Shopify, and detects the platform", async () => {
    servePage("/products/produit-3679", "real/mcb-paris.html");
    // The rewrite of CDN addresses removes the marker the worker looks for: put one back.
    routes["/products/produit-3679"] = {
      ...routes["/products/produit-3679"],
      body: `${routes["/products/produit-3679"]?.body}<script>var Shopify = { shop: "x" }; Shopify.shop = "x";</script>`,
    };
    serveJs("/products/produit-3679.js", "real/mcb-paris.js.json");
    const t = await setup("/products/produit-3679");

    await runCapture(t.capture.id, deps);

    const r = await load(t.capture.id, t.product.id);
    expect(r.capture?.method).toBe("shopify");
    expect(shop.hits.filter((h) => h.startsWith("/products/"))).toEqual([
      "/products/produit-3679",
      "/products/produit-3679.js",
    ]);
    const [s] = await handle.db.select().from(schema.shops).where(eq(schema.shops.id, t.shop.id));
    expect(s?.platform).toBe("shopify");
  });

  it("pre-fills the platform of an unknown shop from an admin_test or monitor capture, touching no product", async () => {
    for (const trigger of ["admin_test", "monitor"] as const) {
      servePage("/products/produit-3679", "real/mcb-paris.html");
      routes["/products/produit-3679"] = {
        ...routes["/products/produit-3679"],
        body: `${routes["/products/produit-3679"]?.body}<script>var Shopify = { shop: "x" }; Shopify.shop = "x";</script>`,
      };
      serveJs("/products/produit-3679.js", "real/mcb-paris.js.json");
      const t = await setup("/products/produit-3679", {}, trigger);

      await runCapture(t.capture.id, deps);

      const r = await load(t.capture.id, t.product.id);
      expect(r.capture?.status).toBe("succeeded");
      const [s] = await handle.db.select().from(schema.shops).where(eq(schema.shops.id, t.shop.id));
      expect(s?.platform).toBe("shopify");
      expect(r.product?.name).toBe("Robe");
      expect(r.product?.captureStatus).toBe("pending");
      expect(r.sizes).toEqual([]);
      expect(r.history).toEqual([]);
      expect(r.images).toEqual([]);
    }
  });

  it("records the platform read on the page: unknown or other becomes the platform found", async () => {
    const woo = '<script src="/wp-content/plugins/woocommerce/assets/js/frontend/woocommerce.min.js"></script>';
    for (const platform of ["unknown", "other"] as const) {
      servePage("/produit/robe", "synthetic/jsonld-simple.html");
      routes["/produit/robe"] = { ...routes["/produit/robe"], body: `${routes["/produit/robe"]?.body}${woo}` };
      const t = await setup("/produit/robe", { shop: { platform } }, "admin_test");

      await runCapture(t.capture.id, deps);

      expect((await load(t.capture.id, t.product.id)).capture?.status).toBe("succeeded");
      const [s] = await handle.db.select().from(schema.shops).where(eq(schema.shops.id, t.shop.id));
      expect(s?.platform, platform).toBe("woocommerce");
    }
  });

  it("records the platform even when the page is no product (a Wix home page)", async () => {
    servePage("/", "synthetic/opengraph-home.html");
    routes["/"] = {
      ...routes["/"],
      body: `${routes["/"]?.body}<img src="https://static.wixstatic.com/media/a.jpg">`,
    };
    const t = await setup("/", { shop: { platform: "unknown" } });

    await runCapture(t.capture.id, deps);

    expect((await load(t.capture.id, t.product.id)).capture?.errorCode).toBe("not_a_product");
    const [s] = await handle.db.select().from(schema.shops).where(eq(schema.shops.id, t.shop.id));
    expect(s?.platform).toBe("wix");
  });

  it("never downgrades a platform: Shopify stays Shopify, a known one never becomes other", async () => {
    const wix = '<img src="https://static.wixstatic.com/media/a.jpg">';
    for (const [platform, body] of [
      ["shopify", wix],
      ["prestashop", wix],
      ["woocommerce", ""],
    ] as const) {
      servePage("/produit/robe", "synthetic/jsonld-simple.html");
      routes["/produit/robe"] = { ...routes["/produit/robe"], body: `${routes["/produit/robe"]?.body}${body}` };
      const t = await setup("/produit/robe", { shop: { platform } }, "admin_test");

      await runCapture(t.capture.id, deps);

      expect((await load(t.capture.id, t.product.id)).capture?.status).toBe("succeeded");
      const [s] = await handle.db.select().from(schema.shops).where(eq(schema.shops.id, t.shop.id));
      expect(s?.platform, platform).toBe(platform);
    }
  });

  it("a photo from cdn.shopify.com alone never makes a shop Shopify: its .js is tried, fails, nothing stored", async () => {
    const photo = '<img src="https://cdn.shopify.com/s/files/robe.jpg">';
    for (const platform of ["unknown", "other"] as const) {
      servePage("/products/robe", "synthetic/jsonld-simple.html");
      routes["/products/robe"] = { ...routes["/products/robe"], body: `${routes["/products/robe"]?.body}${photo}` };
      routes["/products/robe.js"] = { status: 404, headers: { "content-type": "application/json" }, body: "{}" };
      const t = await setup("/products/robe", { shop: { platform } }, "admin_test");

      await runCapture(t.capture.id, deps);

      expect((await load(t.capture.id, t.product.id)).capture?.status).toBe("succeeded");
      expect(shop.hits).toContain("/products/robe.js");
      const [s] = await handle.db.select().from(schema.shops).where(eq(schema.shops.id, t.shop.id));
      expect(s?.platform, platform).toBe("other");
    }
  });

  it("an other shop whose page is Shopify's and whose .js answers becomes Shopify", async () => {
    servePage("/products/produit-3679", "real/mcb-paris.html");
    routes["/products/produit-3679"] = {
      ...routes["/products/produit-3679"],
      body: `${routes["/products/produit-3679"]?.body}<img src="https://cdn.shopify.com/s/files/robe.jpg">`,
    };
    serveJs("/products/produit-3679.js", "real/mcb-paris.js.json");
    const t = await setup("/products/produit-3679", { shop: { platform: "other" } }, "admin_test");

    await runCapture(t.capture.id, deps);

    expect((await load(t.capture.id, t.product.id)).capture?.method).toBe("shopify");
    const [s] = await handle.db.select().from(schema.shops).where(eq(schema.shops.id, t.shop.id));
    expect(s?.platform).toBe("shopify");
  });

  it("a failed platform write never fails the capture", async () => {
    servePage("/produit/robe", "synthetic/jsonld-simple.html");
    routes["/produit/robe"] = {
      ...routes["/produit/robe"],
      body: `${routes["/produit/robe"]?.body}<img src="https://static.wixstatic.com/media/a.jpg">`,
    };
    const t = await setup("/produit/robe", { shop: { platform: "other" } }, "admin_test");
    const failing = new Proxy(handle.db, {
      get(target, key, receiver) {
        if (key !== "update") return Reflect.get(target, key, receiver);
        return (table: unknown) =>
          table === schema.shops
            ? {
                set: () => ({
                  where: () => Promise.reject(new Error("db down")),
                }),
              }
            : target.update(table as typeof schema.captures);
      },
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await runCapture(t.capture.id, { ...deps, db: failing });

    log.mockRestore();
    expect((await load(t.capture.id, t.product.id)).capture?.status).toBe("succeeded");
    const [s] = await handle.db.select().from(schema.shops).where(eq(schema.shops.id, t.shop.id));
    expect(s?.platform).toBe("other");
  });

  it("an unknown shop whose page shows no platform becomes other, as before", async () => {
    servePage("/produit/robe", "synthetic/jsonld-simple.html");
    const t = await setup("/produit/robe", { shop: { platform: "unknown" } }, "admin_test");

    await runCapture(t.capture.id, deps);

    const [s] = await handle.db.select().from(schema.shops).where(eq(schema.shops.id, t.shop.id));
    expect(s?.platform).toBe("other");
  });

  it("files a rule-classified product and stores the raw shop fields", async () => {
    await seedReference(handle.db);
    serveJs("/products/produit-3679.js", "real/mcb-paris.js.json");
    const t = await setup("/products/produit-3679", { shop: { platform: "shopify" } });

    await runCapture(t.capture.id, deps);

    const r = await load(t.capture.id, t.product.id);
    const [pantalons] = await handle.db.select().from(schema.categories).where(eq(schema.categories.slug, "pantalons"));
    expect(r.product?.categoryId).toBe(pantalons?.id);
    expect(r.product?.classifiedBy).toBe("rule");
    expect(r.product?.publishedAt).toBeInstanceOf(Date);
    expect(r.product?.shopData).toBeTypeOf("object");
    expect(Object.keys(r.product?.shopData ?? {}).length).toBeGreaterThan(0);
  });

  it("dates a product by its page (shop), keeps a date set by the admin, and never invents one", async () => {
    serveJs("/products/produit-3679.js", "real/mcb-paris.js.json");
    const dated = await setup("/products/produit-3679", { shop: { platform: "shopify" } });
    await runCapture(dated.capture.id, deps);
    const fromShop = (await load(dated.capture.id, dated.product.id)).product;
    expect(fromShop?.publishedSource).toBe("shop");
    expect(fromShop?.publishedAt).toBeInstanceOf(Date);

    const byHand = new Date("2026-01-15T00:00:00Z");
    const admin = await setup("/products/produit-3679", {
      shop: { platform: "shopify" },
      product: { publishedAt: byHand, publishedSource: "admin" },
    });
    await runCapture(admin.capture.id, deps);
    expect((await load(admin.capture.id, admin.product.id)).product).toMatchObject({
      publishedAt: byHand,
      publishedSource: "admin",
    });

    // A page without a date: the row keeps what it had (unknown: no date; first seen: its hour).
    servePage("/produit/sans-date", "synthetic/jsonld-simple.html");
    const unknown = await setup("/produit/sans-date", { shop: { platform: "other" } });
    await runCapture(unknown.capture.id, deps);
    expect((await load(unknown.capture.id, unknown.product.id)).product).toMatchObject({
      publishedAt: null,
      publishedSource: "unknown",
    });
    const seenAt = new Date("2026-11-10T15:00:00Z");
    const firstSeen = await setup("/produit/sans-date", {
      shop: { platform: "other" },
      product: { publishedAt: seenAt, publishedSource: "first_seen" },
    });
    await runCapture(firstSeen.capture.id, deps);
    expect((await load(firstSeen.capture.id, firstSeen.product.id)).product).toMatchObject({
      publishedAt: seenAt,
      publishedSource: "first_seen",
    });
  });

  it("never changes the classification of an admin-corrected product, but refreshes the raw fields", async () => {
    await seedReference(handle.db);
    serveJs("/products/produit-3679.js", "real/mcb-paris.js.json");
    const [sacs] = await handle.db.select().from(schema.categories).where(eq(schema.categories.slug, "sacs"));
    const t = await setup("/products/produit-3679", {
      shop: { platform: "shopify" },
      product: {
        classifiedBy: "admin",
        name: "Nom corrigé",
        brand: "Marque corrigée",
        priceCents: 1,
        categoryId: sacs?.id ?? null,
        audience: "men",
        season: "all",
      },
    });

    await runCapture(t.capture.id, deps);

    const r = await load(t.capture.id, t.product.id);
    expect(r.product?.categoryId).toBe(sacs?.id);
    expect(r.product?.audience).toBe("men");
    expect(r.product?.season).toBe("all");
    expect(r.product?.classifiedBy).toBe("admin");
    expect(r.product?.name).toBe("Nom corrigé");
    expect(r.product?.brand).toBe("Marque corrigée");
    expect(r.product?.priceCents).toBeGreaterThan(1);
    expect(r.product?.publishedAt).toBeInstanceOf(Date);
    expect(Object.keys(r.product?.shopData ?? {}).length).toBeGreaterThan(0);
  });

  it("keeps the previous classification when a re-capture finds less", async () => {
    await seedReference(handle.db);
    serveJs("/products/produit-3679.js", "real/mcb-paris.js.json");
    const [robes] = await handle.db.select().from(schema.categories).where(eq(schema.categories.slug, "robes"));
    const [noir] = await handle.db.select().from(schema.colors).where(eq(schema.colors.slug, "noir"));
    const t = await setup("/products/produit-3679", {
      shop: { platform: "shopify" },
      product: { categoryId: robes?.id ?? null, colorId: noir?.id ?? null, audience: "women" },
    });
    // « PANTALON LEONIE » finds Pantalons (new match overwrites), no audience or colour (kept).
    await runCapture(t.capture.id, deps);
    const r = await load(t.capture.id, t.product.id);
    const [pantalons] = await handle.db.select().from(schema.categories).where(eq(schema.categories.slug, "pantalons"));
    expect(r.product?.categoryId).toBe(pantalons?.id);
    expect(r.product?.colorId).toBe(noir?.id);
    expect(r.product?.audience).toBe("women");
  });

  it("files the category from the product type first (catalogue classification) and the colour option", async () => {
    await seedReference(handle.db);
    routes["/products/fluide.js"] = {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 9, title: "Pantalon fluide bordeaux", type: "Robe", price: 4990, images: [] }),
    };
    const t = await setup("/products/fluide", { shop: { platform: "shopify" } });

    await runCapture(t.capture.id, deps);

    const r = await load(t.capture.id, t.product.id);
    const [robes] = await handle.db.select().from(schema.categories).where(eq(schema.categories.slug, "robes"));
    const [bordeaux] = await handle.db.select().from(schema.colors).where(eq(schema.colors.slug, "bordeaux"));
    expect(r.product?.categoryId).toBe(robes?.id);
    expect(r.product?.colorId).toBe(bordeaux?.id);
  });

  it("keeps the category and colour the admin filed in the catalogue (category_source admin)", async () => {
    await seedReference(handle.db);
    serveJs("/products/produit-3679.js", "real/mcb-paris.js.json");
    const [sacs] = await handle.db.select().from(schema.categories).where(eq(schema.categories.slug, "sacs"));
    const [noir] = await handle.db.select().from(schema.colors).where(eq(schema.colors.slug, "noir"));
    const t = await setup("/products/produit-3679", {
      shop: { platform: "shopify" },
      product: { categoryId: sacs?.id ?? null, colorId: noir?.id ?? null, categorySource: "admin" },
    });

    await runCapture(t.capture.id, deps);

    const r = await load(t.capture.id, t.product.id);
    expect(r.product?.categoryId).toBe(sacs?.id);
    expect(r.product?.colorId).toBe(noir?.id);
    expect(r.product?.categorySource).toBe("admin");
    expect(r.product?.name).toBe("PANTALON LEONIE");
  });

  it("falls back to the HTML page when the .js fails", async () => {
    servePage("/products/produit-3679", "real/mcb-paris.html");
    const t = await setup("/products/produit-3679", { shop: { platform: "shopify" } });

    await runCapture(t.capture.id, deps);

    const r = await load(t.capture.id, t.product.id);
    expect(r.capture?.status).toBe("succeeded");
    expect(r.capture?.method).not.toBe("shopify");
  });

  it("a sheet's refresh writes the product like her capture, with a history row only on a change", async () => {
    serveJs("/products/produit-3679.js", "real/mcb-paris.js.json");
    const t = await setup("/products/produit-3679", { shop: { platform: "shopify" } }, "refresh");

    await runCapture(t.capture.id, deps);
    const first = await load(t.capture.id, t.product.id);
    expect(first.capture).toMatchObject({ status: "succeeded", dataReady: true, result: null });
    expect(first.product).toMatchObject({ name: "PANTALON LEONIE", captureStatus: "ok" });
    expect(first.history).toHaveLength(1);

    // Read again, same content: the check date moves, no new history row.
    const again = await newCapture(t.shop.id, t.product.id, t.url, "refresh");
    await runCapture(again.id, deps);
    const second = await load(again.id, t.product.id);
    expect(second.capture?.status).toBe("succeeded");
    expect(second.history).toHaveLength(1);
    expect(second.product?.lastCapturedAt?.getTime()).toBeGreaterThanOrEqual(
      first.product?.lastCapturedAt?.getTime() ?? 0,
    );
  });

  it("a Shopify 429/430 on the .js stops the capture (no HTML fallback) and slows Shopify imports down", async () => {
    await handle.db.delete(schema.crawlSlowdowns);
    for (const status of [430, 429]) {
      const path = `/products/busy-${status}`;
      routes[`${path}.js`] = { status, headers: { "content-type": "application/json" }, body: "{}" };
      servePage(path, "real/mcb-paris.html");
      const t = await setup(path, { shop: { platform: "shopify" } }, "refresh");
      await runCapture(t.capture.id, deps);
      const r = await load(t.capture.id, t.product.id);
      expect(r.capture).toMatchObject({ status: "failed", errorCode: "blocked", httpStatus: status });
      expect(shop.hits).not.toContain(path);
    }
    // Two rejections seconds apart are one burst: doubled, not nightly.
    const [state] = await handle.db.select().from(schema.crawlSlowdowns);
    expect(state?.level).toBe("doubled");
    await handle.db.delete(schema.crawlSlowdowns);
  });

  it("a 429 from a shop not on Shopify slows nothing down", async () => {
    await handle.db.delete(schema.crawlSlowdowns);
    routes["/other-busy"] = { status: 429, headers: { "content-type": "text/html" }, body: "non" };
    const t = await setup("/other-busy", { shop: { platform: "other" } });
    await runCapture(t.capture.id, deps);
    expect((await load(t.capture.id, t.product.id)).capture?.status).toBe("failed");
    expect(await handle.db.select().from(schema.crawlSlowdowns)).toEqual([]);
  });

  it("takes a Shopify slot: high for a person's capture or a refresh, low for a monitor, none off Shopify", async () => {
    serveJs("/products/produit-3679.js", "real/mcb-paris.js.json");
    servePage("/plain", "real/zalando.html");
    const waits: unknown[] = [];
    deps.throttle = {
      wait: async (_domain, options) => {
        waits.push(options?.shopify ?? null);
      },
    };
    for (const trigger of ["user", "refresh", "monitor"] as const) {
      const t = await setup("/products/produit-3679", { shop: { platform: "shopify" } }, trigger);
      await runCapture(t.capture.id, deps);
    }
    const plain = await setup("/plain", { shop: { platform: "other" } });
    await runCapture(plain.capture.id, deps);
    expect(waits).toEqual(["high", "medium", "low", null]);
  });

  describe("an imported WooCommerce product", () => {
    const API = "/wp-json/wc/store/v1/products";
    const JSON_TYPE = { "content-type": "application/json; charset=UTF-8" };
    const SIZES = ["S", "M", "L", "XL", "XXL"];
    const bulkPath = `${API}?type=variation&parent[]=77&per_page=100&page=1`;
    const prices = (price: string) => ({
      price,
      regular_price: price,
      sale_price: price,
      currency_code: "EUR",
      currency_minor_unit: 2,
    });
    const variation = (id: number, inStock: boolean) => ({
      id,
      parent: 77,
      type: "variation",
      variation: "Taille: x",
      is_in_stock: inStock,
      is_purchasable: true,
      prices: prices("5900"),
    });

    /**
     * The product (WooCommerce id 77, sizes S to XXL: variations 770 to 774) on its Store API, its variations listed
     * at once (`inStock`: those in stock; the others are not listed) and one by one.
     */
    function serveWoo(options: { inStock?: number[]; permalink?: string } = {}) {
      const inStock = options.inStock ?? [770];
      routes[`${API}/77`] = {
        headers: JSON_TYPE,
        body: JSON.stringify({
          id: 77,
          name: "Robe portefeuille",
          type: "variable",
          permalink: options.permalink ?? `${shop.origin}/produit/robe-77/`,
          description: "<p>Robe fluide</p>",
          prices: prices("5900"),
          images: [],
          categories: [{ id: 1, name: "Robes" }],
          tags: [],
          attributes: [
            {
              id: 1,
              name: "Taille",
              taxonomy: "pa_taille",
              has_variations: true,
              terms: SIZES.map((s, i) => ({ id: i, name: s, slug: s.toLowerCase() })),
            },
          ],
          variations: SIZES.map((s, i) => ({ id: 770 + i, attributes: [{ name: "Taille", value: s.toLowerCase() }] })),
          is_in_stock: true,
          is_purchasable: true,
        }),
      };
      routes[bulkPath] = {
        headers: { ...JSON_TYPE, "x-wp-total": String(inStock.length), "x-wp-totalpages": "1" },
        body: JSON.stringify(inStock.map((id) => variation(id, true))),
      };
      SIZES.forEach((_, i) => {
        const id = 770 + i;
        routes[`${API}/${id}`] = { headers: JSON_TYPE, body: JSON.stringify(variation(id, inStock.includes(id))) };
      });
    }

    async function setupWoo(trigger: "refresh" | "user" = "refresh", shopValues: Record<string, unknown> = {}) {
      const url = `${shop.origin}/produit/robe-77/`;
      const n = ++counter;
      const [s] = await handle.db
        .insert(schema.shops)
        .values({ name: `Woo ${n}`, slug: `capture-woo-${n}`, platform: "woocommerce", ...shopValues })
        .returning();
      if (!s) throw new Error("no shop");
      // Imported: known by its WooCommerce id, at its own address.
      const [p] = await handle.db
        .insert(schema.products)
        .values({
          shopId: s.id,
          canonicalUrl: canonicalizeUrl(url) ?? url,
          name: "Robe",
          currency: "EUR",
          priceCents: 1,
          externalId: "77",
        })
        .returning();
      if (!p) throw new Error("no product");
      return { shop: s, product: p, url, capture: await newCapture(s.id, p.id, url, trigger) };
    }

    const storeHits = () => shop.hits.filter((hit) => hit !== "/robots.txt");
    const stockOf = async (captureId: string, productId: string) =>
      (await load(captureId, productId)).sizes
        .sort((a, b) => a.position - b.position)
        .map((s) => `${s.label}${s.available ? "" : " (épuisé)"}`);

    it("a sheet's refresh makes 2 requests: the product, then its variations listed at once", async () => {
      serveWoo({ inStock: [770, 772] });
      const waits: unknown[] = [];
      const throttle = deps.throttle;
      deps.throttle = {
        wait: async (domain, options) => {
          waits.push(options ?? null);
          await throttle.wait(domain, options);
        },
      };
      const t = await setupWoo();
      await runCapture(t.capture.id, deps);
      const { capture, product } = await load(t.capture.id, t.product.id);
      expect(capture).toMatchObject({ status: "succeeded", method: "woocommerce", dataReady: true });
      expect(product).toMatchObject({
        name: "Robe portefeuille",
        priceCents: 5900,
        externalId: "77",
        captureStatus: "ok",
      });
      expect(product?.variantsCheckedAt).not.toBeNull();
      // A variation the listing does not hold is sold out.
      expect(await stockOf(t.capture.id, t.product.id)).toEqual([
        "S",
        "M (épuisé)",
        "L",
        "XL (épuisé)",
        "XXL (épuisé)",
      ]);
      expect(storeHits()).toEqual([`${API}/77`, bulkPath]);
      expect(waits.every((w) => w === null)).toBe(true);

      // A size back in stock shows on the next refresh.
      serveWoo({ inStock: [770, 771, 772] });
      const again = await newCapture(t.shop.id, t.product.id, t.url, "refresh");
      await runCapture(again.id, deps);
      expect((await stockOf(again.id, t.product.id))[1]).toBe("M");
    });

    it("a sheet's refresh keeps the last known stock of a variation listed in a shape it cannot read", async () => {
      serveWoo({ inStock: [770] });
      // M (771) is listed, but unreadable (no stock, no price): still on sale, its stock unknown.
      routes[bulkPath] = {
        headers: { ...JSON_TYPE, "x-wp-total": "2", "x-wp-totalpages": "1" },
        body: JSON.stringify([variation(770, true), { id: 771, parent: 77, type: "variation" }]),
      };
      const t = await setupWoo();
      await handle.db
        .insert(schema.productSizes)
        .values(SIZES.map((label, position) => ({ productId: t.product.id, label, position, available: true })));
      await runCapture(t.capture.id, deps);
      expect((await load(t.capture.id, t.product.id)).capture).toMatchObject({
        status: "succeeded",
        method: "woocommerce",
      });
      // M keeps its last stock (in stock), never taken for sold out; the sizes not listed are sold out.
      expect(await stockOf(t.capture.id, t.product.id)).toEqual([
        "S",
        "M",
        "L (épuisé)",
        "XL (épuisé)",
        "XXL (épuisé)",
      ]);
      // Not every variation was read: not a complete check.
      expect((await load(t.capture.id, t.product.id)).product?.variantsCheckedAt).toBeNull();
    });

    it("her capture of the product reads it the same way", async () => {
      serveWoo();
      const t = await setupWoo("user");
      await runCapture(t.capture.id, deps);
      expect((await load(t.capture.id, t.product.id)).capture?.method).toBe("woocommerce");
      expect(storeHits()).toEqual([`${API}/77`, bulkPath]);
    });

    it("a shop that refuses the listing (400): remembered, then at most 4 requests, the other sizes as last known", async () => {
      serveWoo({ inStock: [771] });
      routes[bulkPath] = { status: 400, headers: JSON_TYPE, body: JSON.stringify({ code: "rest_invalid_param" }) };
      const t = await setupWoo();
      await handle.db
        .insert(schema.productSizes)
        .values(
          SIZES.map((label, position) => ({ productId: t.product.id, label, position, available: label === "XXL" })),
        );
      await runCapture(t.capture.id, deps);
      // The product, the refused listing, then 2 variations: 4 requests.
      expect(storeHits()).toEqual([`${API}/77`, bulkPath, `${API}/770`, `${API}/771`]);
      expect(await stockOf(t.capture.id, t.product.id)).toEqual([
        "S (épuisé)",
        "M",
        "L (épuisé)",
        "XL (épuisé)",
        "XXL",
      ]);
      const [s] = await handle.db.select().from(schema.shops).where(eq(schema.shops.id, t.shop.id));
      expect(s?.importHints).toMatchObject({ wooSingleSince: expect.any(String) });
      expect((await load(t.capture.id, t.product.id)).product?.variantsCheckedAt).toBeNull();

      // Remembered: straight to the variations, 3 of them.
      shop.hits.length = 0;
      const again = await newCapture(t.shop.id, t.product.id, t.url, "refresh");
      await runCapture(again.id, deps);
      expect(storeHits()).toEqual([`${API}/77`, `${API}/770`, `${API}/771`, `${API}/772`]);
    });

    it("falls back to the page when the Store API is off or speaks of another product", async () => {
      routes["/produit/robe-77/"] = {
        headers: { "content-type": "text/html; charset=utf-8" },
        body: fixture("synthetic/jsonld-simple.html").toString("utf8"),
      };
      const off = await setupWoo();
      await runCapture(off.capture.id, deps);
      expect((await load(off.capture.id, off.product.id)).capture).toMatchObject({
        status: "succeeded",
        method: "jsonld",
      });

      serveWoo({ permalink: `${shop.origin}/produit/autre/` });
      shop.hits.length = 0;
      const other = await newCapture(off.shop.id, off.product.id, off.url, "refresh");
      await runCapture(other.id, deps);
      expect((await load(other.id, off.product.id)).capture?.method).toBe("jsonld");
      expect(shop.hits).not.toContain(bulkPath);
    });

    it("a refusal from the Store API fails the refresh without asking the page", async () => {
      serveWoo();
      routes[`${API}/77`] = { status: 403, headers: JSON_TYPE, body: "{}" };
      const t = await setupWoo();
      await runCapture(t.capture.id, deps);
      expect((await load(t.capture.id, t.product.id)).capture).toMatchObject({
        status: "failed",
        errorCode: "blocked",
        httpStatus: 403,
      });
      expect(shop.hits).not.toContain("/produit/robe-77/");
    });

    it("an HTML page where the variations should be is a refusal", async () => {
      serveWoo();
      routes[bulkPath] = { headers: { "content-type": "text/html" }, body: "<html>Vérification</html>" };
      const t = await setupWoo();
      await runCapture(t.capture.id, deps);
      expect((await load(t.capture.id, t.product.id)).capture).toMatchObject({
        status: "failed",
        errorCode: "blocked",
      });
    });
  });

  it("drops a sheet's refresh that waited over 30 s, before any request", async () => {
    serveJs("/products/produit-3679.js", "real/mcb-paris.js.json");
    const t = await setup("/products/produit-3679", { shop: { platform: "shopify" } }, "refresh");
    await handle.db
      .update(schema.captures)
      .set({ createdAt: new Date(Date.now() - 31_000) })
      .where(eq(schema.captures.id, t.capture.id));

    await runCapture(t.capture.id, deps);

    const r = await load(t.capture.id, t.product.id);
    expect(r.capture).toMatchObject({ status: "failed", errorCode: "timeout" });
    expect(r.product?.captureStatus).not.toBe("failed");
    expect(shop.hits).toEqual([]);
  });

  it("an unknown shop found to be Shopify becomes one: its .js takes the line, and its 429 slows Shopify down", async () => {
    await handle.db.delete(schema.crawlSlowdowns);
    servePage("/products/inconnu", "real/mcb-paris.html");
    routes["/products/inconnu"] = {
      headers: { "content-type": "text/html; charset=utf-8" },
      body: `${(routes["/products/inconnu"]?.body ?? "").toString()}<script>Shopify.shop = "x";</script>`,
    };
    routes["/products/inconnu.js"] = { status: 429, headers: { "content-type": "application/json" }, body: "{}" };
    const waits: unknown[] = [];
    deps.throttle = {
      wait: async (_domain, options) => {
        waits.push(options?.shopify ?? null);
      },
    };
    const t = await setup("/products/inconnu", { shop: { platform: "unknown" } });

    await runCapture(t.capture.id, deps);

    const r = await load(t.capture.id, t.product.id);
    expect(r.capture).toMatchObject({ status: "failed", errorCode: "blocked", httpStatus: 429 });
    // The page before it was known, then its .js on the line.
    expect(waits).toEqual([null, "high"]);
    expect((await handle.db.select().from(schema.shops).where(eq(schema.shops.id, t.shop.id)))[0]?.platform).toBe(
      "shopify",
    );
    expect((await handle.db.select().from(schema.crawlSlowdowns))[0]?.level).toBe("doubled");
    await handle.db.delete(schema.crawlSlowdowns);
  });

  it("checks robots.txt before taking a slot: the slot goes to the page alone", async () => {
    const events: string[] = [];
    routes["/robots.txt"] = { headers: { "content-type": "text/plain" }, body: "User-agent: *\nAllow: /\n" };
    serveJs("/products/produit-3679.js", "real/mcb-paris.js.json");
    deps.throttle = {
      wait: async () => {
        events.push(`slot after ${shop.hits.filter((h) => h === "/robots.txt").length} robots`);
      },
    };
    const t = await setup("/products/produit-3679", { shop: { platform: "shopify" } });
    await runCapture(t.capture.id, deps);
    expect(events[0]).toBe("slot after 1 robots");
  });

  it("extracts JSON-LD from a Zalando page", async () => {
    servePage("/leggings.html", "real/zalando.html");
    const t = await setup("/leggings.html");

    await runCapture(t.capture.id, deps);

    const r = await load(t.capture.id, t.product.id);
    expect(r.capture?.status).toBe("succeeded");
    expect(r.capture?.method).toBe("jsonld");
    expect(r.sizes.length).toBeGreaterThan(0);
    expect(r.images).toHaveLength(EXPECTED_ZALANDO_PHOTOS);
    const [s] = await handle.db.select().from(schema.shops).where(eq(schema.shops.id, t.shop.id));
    expect(s?.platform).toBe("other");
  });

  it("fails a home page with not_a_product and marks the product failed", async () => {
    servePage("/", "synthetic/opengraph-home.html");
    const t = await setup("/");

    await runCapture(t.capture.id, deps);

    const r = await load(t.capture.id, t.product.id);
    expect(r.capture?.status).toBe("failed");
    expect(r.capture?.errorCode).toBe("not_a_product");
    expect(r.capture?.finishedAt).toBeInstanceOf(Date);
    expect(r.product?.captureStatus).toBe("failed");
    expect(r.history).toHaveLength(0);
  });

  it("maps a 403 to blocked", async () => {
    routes["/p"] = { status: 403, headers: { "content-type": "text/html" }, body: "no" };
    const t = await setup("/p");

    await runCapture(t.capture.id, deps);

    const r = await load(t.capture.id, t.product.id);
    expect(r.capture?.status).toBe("failed");
    expect(r.capture?.errorCode).toBe("blocked");
    expect(r.capture?.httpStatus).toBe(403);
  });

  it("takes a product out of the catalogue on a 404, then puts it back when the page answers again", async () => {
    routes["/gone"] = { status: 404, headers: { "content-type": "text/html" }, body: "introuvable" };
    const t = await setup("/gone");
    const [profile] = await handle.db
      .insert(schema.profiles)
      .values({ userId: await newUser(), name: "Moi", audience: "women", color: "rose" })
      .returning();
    if (!profile) throw new Error("no profile");
    const [item] = await handle.db
      .insert(schema.items)
      .values({ userId: profile.userId, profileId: profile.id, productId: t.product.id })
      .returning();

    await runCapture(t.capture.id, deps);

    const gone = await load(t.capture.id, t.product.id);
    expect(gone.capture?.status).toBe("failed");
    expect(gone.capture?.httpStatus).toBe(404);
    expect(gone.product?.removedAt).toBeInstanceOf(Date);
    // Her item still points at the product, untouched.
    const [kept] = await handle.db
      .select()
      .from(schema.items)
      .where(eq(schema.items.id, item?.id ?? ""));
    expect(kept).toEqual(item);

    servePage("/gone", "real/zalando.html");
    const again = await newCapture(t.shop.id, t.product.id, t.url, "user");
    await runCapture(again.id, deps);

    const back = await load(again.id, t.product.id);
    expect(back.capture?.status).toBe("succeeded");
    expect(back.product?.removedAt).toBeNull();
  });

  it("takes a product out on a 410 seen by the monitor at its test address, and back on success", async () => {
    routes["/test-page"] = { status: 410, headers: { "content-type": "text/html" }, body: "parti" };
    const t = await setup("/test-page");
    await handle.db.update(schema.products).set({ canonicalUrl: t.url }).where(eq(schema.products.id, t.product.id));
    const monitor = await newCapture(t.shop.id, null, t.url, "monitor");

    await runCapture(monitor.id, deps);
    expect((await load(monitor.id, t.product.id)).product?.removedAt).toBeInstanceOf(Date);

    servePage("/test-page", "real/zalando.html");
    const again = await newCapture(t.shop.id, null, t.url, "monitor");
    await runCapture(again.id, deps);
    const back = await load(again.id, t.product.id);
    expect(back.capture?.status).toBe("succeeded");
    expect(back.product?.removedAt).toBeNull();
  });

  it("never takes a product out on an answer that is not definitive (429, 503, 403, robots)", async () => {
    routes["/robots.txt"] = { headers: { "content-type": "text/plain" }, body: "User-agent: *\nDisallow: /robots-no" };
    for (const [path, status] of [
      ["/busy", 429],
      ["/down", 503],
      ["/forbidden", 403],
      ["/robots-no", 200],
    ] as const) {
      routes[path] = { status, headers: { "content-type": "text/html" }, body: "non" };
      const t = await setup(path);
      await runCapture(t.capture.id, deps);
      const r = await load(t.capture.id, t.product.id);
      expect(r.capture?.status).toBe("failed");
      expect(r.product?.removedAt).toBeNull();
    }
  });

  it("maps an unexpected error to http_error", async () => {
    const t = await setup("/p");
    await runCapture(t.capture.id, {
      ...deps,
      robots: {
        allows() {
          throw new Error("boom");
        },
      },
    });
    const r = await load(t.capture.id, t.product.id);
    expect(r.capture?.status).toBe("failed");
    expect(r.capture?.errorCode).toBe("http_error");
  });

  it("does not request the page when robots.txt disallows it", async () => {
    routes["/robots.txt"] = { headers: { "content-type": "text/plain" }, body: "User-agent: *\nDisallow: /" };
    servePage("/leggings.html", "real/zalando.html");
    const t = await setup("/leggings.html");

    await runCapture(t.capture.id, deps);

    const r = await load(t.capture.id, t.product.id);
    expect(r.capture?.errorCode).toBe("robots_disallowed");
    expect(shop.hits).not.toContain("/leggings.html");
  });

  it("does not turn a capture already swept to failed back into succeeded", async () => {
    serveJs("/products/produit-3679.js", "real/mcb-paris.js.json");
    const t = await setup("/products/produit-3679", { shop: { platform: "shopify" } });
    const sweepDuringRun = {
      allows: async () => {
        await handle.db
          .update(schema.captures)
          .set({ status: "failed", errorCode: "timeout", finishedAt: new Date() })
          .where(eq(schema.captures.id, t.capture.id));
        return true;
      },
    };

    await runCapture(t.capture.id, { ...deps, robots: sweepDuringRun });

    const r = await load(t.capture.id, t.product.id);
    expect(r.capture?.status).toBe("failed");
    expect(r.capture?.errorCode).toBe("timeout");
  });

  it("keeps timeout on a capture already swept when the run then fails", async () => {
    const t = await setup("/p");
    const sweepThenDeny = {
      allows: async () => {
        await handle.db
          .update(schema.captures)
          .set({ status: "failed", errorCode: "timeout", finishedAt: new Date() })
          .where(eq(schema.captures.id, t.capture.id));
        return false;
      },
    };

    await runCapture(t.capture.id, { ...deps, robots: sweepThenDeny });

    const r = await load(t.capture.id, t.product.id);
    expect(r.capture?.status).toBe("failed");
    expect(r.capture?.errorCode).toBe("timeout");
  });

  it("keeps a product that was already ok when a capture fails", async () => {
    routes["/p"] = { status: 403, headers: { "content-type": "text/html" }, body: "no" };
    const t = await setup("/p", { product: { captureStatus: "ok" } });

    await runCapture(t.capture.id, deps);

    const r = await load(t.capture.id, t.product.id);
    expect(r.capture?.status).toBe("failed");
    expect(r.product?.captureStatus).toBe("ok");
  });

  it("stores no size for a second-hand shop", async () => {
    servePage("/leggings.html", "real/zalando.html");
    const t = await setup("/leggings.html", { shop: { listingKind: "secondhand" } });

    await runCapture(t.capture.id, deps);

    const r = await load(t.capture.id, t.product.id);
    expect(r.capture?.status).toBe("succeeded");
    expect(r.sizes).toEqual([]);
    expect(r.history[0]?.sizes).toEqual({});
  });

  it("writes only captures.result for admin_test and monitor, and fetches no photo", async () => {
    servePage("/leggings.html", "real/zalando.html");
    for (const trigger of ["admin_test", "monitor"] as const) {
      const t = await setup("/leggings.html", {}, trigger);

      await runCapture(t.capture.id, deps);

      const r = await load(t.capture.id, t.product.id);
      expect(r.capture?.status).toBe("succeeded");
      expect(r.capture?.result).toMatchObject({ currency: expect.any(String), priceCents: expect.any(Number) });
      expect(r.product?.name).toBe("Robe");
      expect(r.product?.captureStatus).toBe("pending");
      expect(r.sizes).toEqual([]);
      expect(r.history).toEqual([]);
      expect(r.images).toEqual([]);
      expect(r.capture?.dataReady).toBe(false);
    }
    expect(imageHits()).toEqual([]);
  });

  it("works without a product for an admin test", async () => {
    servePage("/leggings.html", "real/zalando.html");
    const t = await setup("/leggings.html", {}, "admin_test");
    const capture = await newCapture(t.shop.id, null, t.url, "admin_test");
    await runCapture(capture.id, deps);
    const [c] = await handle.db.select().from(schema.captures).where(eq(schema.captures.id, capture.id));
    expect(c?.status).toBe("succeeded");
    expect(c?.result).not.toBeNull();
  });

  it("does not download known photos again on a second capture and replaces sizes without duplicates", async () => {
    serveJs("/products/produit-3679.js", "real/mcb-paris.js.json");
    const t = await setup("/products/produit-3679", { shop: { platform: "shopify" } });
    await runCapture(t.capture.id, deps);
    const first = imageHits().length;
    expect(first).toBe(5);
    const sizes = (await load(t.capture.id, t.product.id)).sizes.length;

    const second = await newCapture(t.shop.id, t.product.id, t.url, "user");
    await runCapture(second.id, deps);

    expect(imageHits()).toHaveLength(first);
    const r = await load(second.id, t.product.id);
    expect(r.capture?.status).toBe("succeeded");
    expect(r.images).toHaveLength(5);
    expect(r.sizes).toHaveLength(sizes);
    expect(r.history).toHaveLength(2);
  });

  it("ignores a photo that fails", async () => {
    serveJs("/products/produit-3679.js", "real/mcb-paris.js.json");
    const t = await setup("/products/produit-3679", { shop: { platform: "shopify" } });
    await runCapture(t.capture.id, deps); // creates the routes
    for (const path of Object.keys(routes).filter((p) => p.startsWith("/img/"))) delete routes[path];
    await handle.db.delete(schema.productImages).where(eq(schema.productImages.productId, t.product.id));

    const again = await newCapture(t.shop.id, t.product.id, t.url, "user");
    await runCapture(again.id, deps);

    const r = await load(again.id, t.product.id);
    expect(r.capture?.status).toBe("succeeded");
    expect(r.images).toEqual([]);
  });

  it("never holds more than 8 photos for a product", async () => {
    serveJs("/products/produit-3679.js", "real/mcb-paris.js.json");
    const t = await setup("/products/produit-3679", { shop: { platform: "shopify" } });
    await handle.db.insert(schema.productImages).values(
      Array.from({ length: 6 }, (_, i) => ({
        productId: t.product.id,
        position: i,
        key: `k${i}`,
        width: 1,
        height: 1,
        sourceHash: `old${i}`,
      })),
    );

    await runCapture(t.capture.id, deps);

    expect((await load(t.capture.id, t.product.id)).images).toHaveLength(8);
    expect(imageHits()).toHaveLength(2);
  });

  it("gives new photos unique positions after the existing ones", async () => {
    serveJs("/products/produit-3679.js", "real/mcb-paris.js.json");
    const t = await setup("/products/produit-3679", { shop: { platform: "shopify" } });
    await handle.db.insert(schema.productImages).values(
      [0, 1].map((i) => ({
        productId: t.product.id,
        position: i,
        key: `k${i}`,
        width: 1,
        height: 1,
        sourceHash: `old${i}`,
      })),
    );
    await runCapture(t.capture.id, deps);
    const second = await newCapture(t.shop.id, t.product.id, t.url, "user");
    await runCapture(second.id, deps);

    const positions = (await load(second.id, t.product.id)).images.map((i) => i.position).sort((a, b) => a - b);
    expect(positions).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("still succeeds when the photo step hits a store error", async () => {
    serveJs("/products/produit-3679.js", "real/mcb-paris.js.json");
    const t = await setup("/products/produit-3679", { shop: { platform: "shopify" } });
    const failing = { ...store, put: () => Promise.reject(new Error("store down")) };
    await runCapture(t.capture.id, { ...deps, store: failing });
    const r = await load(t.capture.id, t.product.id);
    expect(r.capture?.status).toBe("succeeded");
    expect(r.product?.captureStatus).toBe("ok");
  });

  it("still succeeds when the photo step hits a database error", async () => {
    serveJs("/products/produit-3679.js", "real/mcb-paris.js.json");
    const t = await setup("/products/produit-3679", { shop: { platform: "shopify" } });
    const select = handle.db.select.bind(handle.db);
    let calls = 0;
    // Selects before the data transaction: shop, product classification, 4 reference lists; then copyImages' read.
    const db = new Proxy(handle.db, {
      get(target, prop) {
        if (prop === "select") {
          return (...args: Parameters<typeof select>) => {
            if (++calls === 7) throw new Error("db down");
            return select(...args);
          };
        }
        return Reflect.get(target, prop, target);
      },
    });
    await runCapture(t.capture.id, { ...deps, db });
    const r = await load(t.capture.id, t.product.id);
    expect(r.capture?.status).toBe("succeeded");
    expect(r.product?.captureStatus).toBe("ok");
    expect(r.images).toEqual([]);
  });

  it("decodes an ISO-8859-1 page", async () => {
    const page = `<html><head><meta property="og:title" content="Robe élégante"><meta property="product:price:amount" content="29.99"><meta property="product:price:currency" content="EUR"></head></html>`;
    routes["/latin"] = {
      headers: { "content-type": "text/html; charset=ISO-8859-1" },
      body: Buffer.from(page, "latin1"),
    };
    const t = await setup("/latin");

    await runCapture(t.capture.id, deps);

    const r = await load(t.capture.id, t.product.id);
    expect(r.product?.name).toBe("Robe élégante");
  });

  it("ignores a capture that is not queued", async () => {
    servePage("/leggings.html", "real/zalando.html");
    const t = await setup("/leggings.html");
    await handle.db.update(schema.captures).set({ status: "running" }).where(eq(schema.captures.id, t.capture.id));

    await runCapture(t.capture.id, deps);

    expect(shop.hits).toEqual([]);
    const r = await load(t.capture.id, t.product.id);
    expect(r.capture?.status).toBe("running");
  });

  it("ignores an unknown capture", async () => {
    await expect(runCapture("00000000-0000-4000-8000-000000000000", deps)).resolves.toBeUndefined();
  });
});
