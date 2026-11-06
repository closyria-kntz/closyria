import type dns from "node:dns";
import { readFileSync } from "node:fs";
import { createDb, eq, schema } from "@closyria/db";
import { memoryStore } from "@closyria/storage";
import { type FakeRoute, type FakeShop, startFakeShop } from "@closyria/testing";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
  trigger: "user" | "admin_test" | "monitor" = "user",
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
  trigger: "user" | "admin_test" | "monitor",
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

  it("falls back to the HTML page when the .js fails", async () => {
    servePage("/products/produit-3679", "real/mcb-paris.html");
    const t = await setup("/products/produit-3679", { shop: { platform: "shopify" } });

    await runCapture(t.capture.id, deps);

    const r = await load(t.capture.id, t.product.id);
    expect(r.capture?.status).toBe("succeeded");
    expect(r.capture?.method).not.toBe("shopify");
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
