import { eq, recordShopifyRejection, schema } from "@closyria/db";
import { adminOverviewSchema, adminShopDetailSchema } from "@closyria/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let adminCookie: string;
let userCookie: string;
let counter = 0;
const NOW = new Date("2026-11-05T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness({ now: () => NOW });
  const admin = await t.signIn();
  await t.db.update(schema.user).set({ role: "admin", isAnonymous: false }).where(eq(schema.user.id, admin.userId));
  await t.db.update(schema.session).set({ authMethod: "passkey" }).where(eq(schema.session.userId, admin.userId));
  adminCookie = admin.cookie;
  userCookie = (await t.signIn()).cookie;
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

function call(method: string, path: string, body?: unknown, cookie = adminCookie) {
  return t.app.request(`/api/admin${path}`, {
    method,
    headers: {
      origin: BASE_URL,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function newShop(overrides: Partial<typeof schema.shops.$inferInsert> = {}, domains: string[] = []) {
  const n = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `Shop ${n}`, slug: `adm-shop-${n}`, ...overrides })
    .returning();
  if (!shop) throw new Error("no shop");
  const list = domains.length > 0 ? domains : [`adm-${n}.test`];
  await t.db.insert(schema.shopDomains).values(list.map((domain) => ({ domain, shopId: shop.id })));
  return shop;
}

async function newProduct(shopId: string, createdAt: Date) {
  const n = ++counter;
  const [p] = await t.db
    .insert(schema.products)
    .values({ shopId, canonicalUrl: `https://p.test/${n}`, createdAt })
    .returning();
  if (!p) throw new Error("no product");
  return p;
}

function newCapture(shopId: string, values: Partial<typeof schema.captures.$inferInsert> = {}) {
  return t.db
    .insert(schema.captures)
    .values({ shopId, url: "https://p.test/x", trigger: "user", status: "succeeded", method: "shopify", ...values })
    .returning()
    .then(
      (rows) =>
        rows[0] ??
        (() => {
          throw new Error("no capture");
        })(),
    );
}

// biome-ignore lint/suspicious/noExplicitAny: loose reader of JSON answers in tests
const json = async (res: Response) => (await res.json()) as Record<string, any>;

describe("access", () => {
  it("refuses a non-admin on every route", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    const routes: [string, string, unknown?][] = [
      ["GET", "/shops"],
      ["GET", `/shops/${id}`],
      ["PATCH", `/shops/${id}`, { name: "x" }],
      ["POST", "/shops", { url: "https://a.test/p" }],
      ["POST", `/shops/${id}/merge`, { targetId: id }],
      ["POST", "/captures/test", { url: "https://a.test/p" }],
      ["GET", `/captures/${id}`],
      ["GET", "/captures/failures"],
      ["POST", `/captures/${id}/retry`, {}],
    ];
    for (const [method, path, body] of routes) {
      expect((await call(method, path, body, userCookie)).status, `${method} ${path}`).toBe(403);
      expect((await call(method, path, body, "")).status, `${method} ${path}`).toBe(401);
    }
  });
});

describe("GET /api/admin/shops", () => {
  it("lists pending shops first by products created over 30 days, then by name; hides merged ones", async () => {
    await t.db.delete(schema.captures);
    await t.db.delete(schema.products);
    await t.db.delete(schema.shopDomains);
    await t.db.update(schema.shops).set({ mergedIntoId: null });
    await t.db.delete(schema.shops);
    const quiet = await newShop({ name: "Quiet", status: "pending" });
    const popular = await newShop({ name: "Zed popular", status: "pending" });
    const alpha = await newShop({ name: "Alpha", status: "pending" });
    const published = await newShop({ name: "Aaa published", status: "published" });
    for (let i = 0; i < 3; i++) await newProduct(popular.id, ago(DAY));
    await newProduct(popular.id, ago(40 * DAY)); // too old
    await newProduct(quiet.id, ago(2 * DAY));
    const target = await newShop({ name: "Target", status: "published" });
    const merged = await newShop({ name: "Merged", status: "pending", mergedIntoId: target.id });
    await newCapture(alpha.id, { status: "failed", errorCode: "timeout", createdAt: ago(HOUR) });

    const res = await call("GET", "/shops");
    expect(res.status).toBe(200);
    const body = await json(res);
    const names = body.shops.map((s: { name: string }) => s.name);
    expect(names).toEqual(["Zed popular", "Quiet", "Alpha", "Aaa published", "Target"]);
    expect(names).not.toContain(merged.name);
    const alphaRow = body.shops.find((s: { id: string }) => s.id === alpha.id);
    expect(alphaRow.lastCapture).toMatchObject({ status: "failed", errorCode: "timeout" });
    expect(alphaRow.domains).toHaveLength(1);
    expect(body.shops.find((s: { id: string }) => s.id === popular.id).recentProducts).toBe(3);
    expect(published.id).toBeDefined();

    const only = await json(await call("GET", "/shops?status=published"));
    expect(only.shops.map((s: { name: string }) => s.name)).toEqual(["Aaa published", "Target"]);
  });

  it("computes health and filters on it", async () => {
    const down = await newShop({ name: "Down shop", status: "published" });
    await newCapture(down.id, { trigger: "monitor", status: "failed", finishedAt: ago(HOUR), createdAt: ago(HOUR) });
    await newCapture(down.id, {
      trigger: "monitor",
      status: "failed",
      finishedAt: ago(2 * HOUR),
      createdAt: ago(2 * HOUR),
    });
    const degraded = await newShop({ name: "Degraded shop", status: "published" });
    await newCapture(degraded.id, { status: "failed", createdAt: ago(HOUR), finishedAt: ago(HOUR) });
    await newCapture(degraded.id, { status: "succeeded", createdAt: ago(2 * HOUR), finishedAt: ago(2 * HOUR) });
    const ok = await newShop({ name: "Ok shop", status: "published" });
    await newCapture(ok.id, { createdAt: ago(HOUR), finishedAt: ago(HOUR) });

    const all = await json(await call("GET", "/shops"));
    const health = (id: string) => all.shops.find((s: { id: string }) => s.id === id).health;
    expect(health(down.id)).toBe("down");
    expect(health(degraded.id)).toBe("degraded");
    expect(health(ok.id)).toBe("ok");
    const filtered = await json(await call("GET", "/shops?health=down"));
    expect(filtered.shops.map((s: { id: string }) => s.id)).toEqual([down.id]);
    expect((await call("GET", "/shops?health=nope")).status).toBe(400);
  });
});

describe("GET /api/admin/shops/:id", () => {
  it("gives settings, domains, health, rate, last monitor and the 10 latest errors", async () => {
    const shop = await newShop({ name: "Detail", status: "published" }, ["detail.test", "detail.fr"]);
    for (let i = 0; i < 12; i++) {
      await newCapture(shop.id, {
        status: "failed",
        errorCode: "http_error",
        httpStatus: 500,
        url: `https://detail.test/p/${i}`,
        createdAt: ago((i + 1) * HOUR),
        finishedAt: ago((i + 1) * HOUR),
      });
    }
    await newCapture(shop.id, {
      trigger: "monitor",
      method: "shopify",
      createdAt: ago(30 * 60_000),
      finishedAt: ago(30 * 60_000),
    });
    // not real fetch attempts: a 24 h reuse (succeeded, no method) and a queue failure
    await newCapture(shop.id, { method: null, createdAt: ago(HOUR), finishedAt: ago(HOUR) });
    await newCapture(shop.id, {
      status: "failed",
      errorCode: "queue_unavailable",
      createdAt: ago(30 * HOUR),
      finishedAt: ago(30 * HOUR),
    });
    const res = await call("GET", `/shops/${shop.id}`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.domains.sort()).toEqual(["detail.fr", "detail.test"]);
    expect(body.successRate7d).toBeCloseTo(1 / 13);
    expect(body.lastMonitor).toMatchObject({ trigger: "monitor", status: "succeeded" });
    expect(body.health).toBe("degraded");
    expect(body.recentErrors).toHaveLength(10);
    expect(body.recentErrors[0]).toMatchObject({
      errorCode: "http_error",
      httpStatus: 500,
      url: "https://detail.test/p/0",
    });
    expect((await call("GET", "/shops/00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });
});

describe("PATCH /api/admin/shops/:id", () => {
  it("edits the settings and replaces the domains, normalised", async () => {
    const shop = await newShop({}, ["old-a.test", "old-b.test"]);
    const res = await call("PATCH", `/shops/${shop.id}`, {
      name: "Renamed",
      status: "published",
      captureMode: "manual",
      listingKind: "secondhand",
      testUrl: "https://new.test/p",
      domains: ["WWW.New.test", "other-new.test"],
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({
      name: "Renamed",
      status: "published",
      captureMode: "manual",
      testUrl: "https://new.test/p",
    });
    expect(body.domains.sort()).toEqual(["new.test", "other-new.test"]);
    const rows = await t.db.select().from(schema.shopDomains).where(eq(schema.shopDomains.shopId, shop.id));
    expect(rows.map((r) => r.domain).sort()).toEqual(["new.test", "other-new.test"]);
  });

  it("answers 409 domain_taken for a domain of another shop, and changes nothing", async () => {
    const a = await newShop({}, ["taken-a.test"]);
    const b = await newShop({}, ["free-b.test"]);
    const res = await call("PATCH", `/shops/${b.id}`, { name: "Changed", domains: ["www.taken-a.test", "x-b.test"] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "domain_taken" });
    const rows = await t.db.select().from(schema.shopDomains).where(eq(schema.shopDomains.shopId, b.id));
    expect(rows.map((r) => r.domain)).toEqual(["free-b.test"]);
    expect(a.id).not.toBe(b.id);
  });

  it("stores the test URL canonical and refuses a non-http(s) one", async () => {
    const shop = await newShop();
    const ok = await call("PATCH", `/shops/${shop.id}`, { testUrl: "https://t.test/p?utm_source=x&variant=2" });
    expect(ok.status).toBe(200);
    expect((await json(ok)).testUrl).toBe("https://t.test/p?variant=2");
    expect((await call("PATCH", `/shops/${shop.id}`, { testUrl: "javascript:alert(1)" })).status).toBe(400);
    expect((await call("PATCH", `/shops/${shop.id}`, { testUrl: null })).status).toBe(200);
  });

  it("answers 409 slug_taken, 400 for a bad slug or no domain, 404 for an unknown shop", async () => {
    const a = await newShop();
    const b = await newShop();
    const taken = await call("PATCH", `/shops/${b.id}`, { slug: a.slug });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: "slug_taken" });
    expect((await call("PATCH", `/shops/${b.id}`, { slug: "Bad Slug" })).status).toBe(400);
    expect((await call("PATCH", `/shops/${b.id}`, { domains: [] })).status).toBe(400);
    expect((await call("PATCH", `/shops/00000000-0000-4000-8000-000000000000`, { name: "x" })).status).toBe(404);
  });
});

describe("POST /api/admin/shops", () => {
  it("creates a draft shop on the domain and queues an admin_test capture", async () => {
    const before = t.calls.length;
    const res = await call("POST", "/shops", { url: "https://WWW.Brand-new.test/products/a?utm_source=x" });
    expect(res.status).toBe(201);
    const { shopId, captureId } = (await json(res)) as { shopId: string; captureId: string };
    const [shop] = await t.db.select().from(schema.shops).where(eq(schema.shops.id, shopId));
    expect(shop).toMatchObject({ status: "draft", name: "brand-new.test", slug: "brand-new-test" });
    const [capture] = await t.db.select().from(schema.captures).where(eq(schema.captures.id, captureId));
    expect(capture).toMatchObject({
      shopId,
      productId: null,
      trigger: "admin_test",
      status: "queued",
      url: "https://www.brand-new.test/products/a",
    });
    expect(t.calls.slice(before)).toEqual([{ queue: "capture-admin", id: captureId }]);
  });

  it("answers 409 domain_taken with the owner's id, and 400 for a bad address", async () => {
    const owner = await newShop({}, ["owned.test"]);
    const res = await call("POST", "/shops", { url: "https://owned.test/p" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "domain_taken", shopId: owner.id });
    const sub = await call("POST", "/shops", { url: "https://shop.owned.test/p" });
    expect(sub.status).toBe(409);
    expect(await sub.json()).toEqual({ error: "domain_taken", shopId: owner.id });
    const survivor = await newShop({}, ["survivor.test"]);
    await newShop({ mergedIntoId: survivor.id }, ["gone.test"]);
    const viaMerged = await call("POST", "/shops", { url: "https://www.gone.test/p" });
    expect(viaMerged.status).toBe(409);
    expect(await viaMerged.json()).toEqual({ error: "domain_taken", shopId: survivor.id });
    const bad = await call("POST", "/shops", { url: "javascript:alert(1)" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_url" });
  });
});

describe("POST /api/admin/shops/:id/merge", () => {
  it("moves domains, products and captures to the target and hides the merged shop", async () => {
    const source = await newShop({ name: "Merge source" }, ["src-merge.test"]);
    const target = await newShop({ name: "Merge target" }, ["dst-merge.test"]);
    const product = await newProduct(source.id, ago(DAY));
    const capture = await newCapture(source.id, { productId: product.id });
    const res = await call("POST", `/shops/${source.id}/merge`, { targetId: target.id });
    expect(res.status).toBe(200);
    const [s] = await t.db.select().from(schema.shops).where(eq(schema.shops.id, source.id));
    expect(s?.mergedIntoId).toBe(target.id);
    const domains = await t.db.select().from(schema.shopDomains).where(eq(schema.shopDomains.shopId, target.id));
    expect(domains.map((d) => d.domain).sort()).toEqual(["dst-merge.test", "src-merge.test"]);
    const [p] = await t.db.select().from(schema.products).where(eq(schema.products.id, product.id));
    expect(p?.shopId).toBe(target.id);
    const [c] = await t.db.select().from(schema.captures).where(eq(schema.captures.id, capture.id));
    expect(c?.shopId).toBe(target.id);
    const list = await json(await call("GET", "/shops"));
    expect(list.shops.map((x: { id: string }) => x.id)).not.toContain(source.id);
    expect(list.shops.map((x: { id: string }) => x.id)).toContain(target.id);
  });

  it("refuses itself, a merged target (400) and unknown shops (404)", async () => {
    const a = await newShop();
    const target = await newShop();
    const merged = await newShop({ mergedIntoId: target.id });
    const self = await call("POST", `/shops/${a.id}/merge`, { targetId: a.id });
    expect(self.status).toBe(400);
    expect(await self.json()).toEqual({ error: "invalid_merge" });
    expect((await call("POST", `/shops/${a.id}/merge`, { targetId: merged.id })).status).toBe(400);
    expect((await call("POST", `/shops/${merged.id}/merge`, { targetId: a.id })).status).toBe(400);
    expect(
      (await call("POST", `/shops/${a.id}/merge`, { targetId: "00000000-0000-4000-8000-000000000000" })).status,
    ).toBe(404);
  });
});

describe("captures", () => {
  it("tests a link: finds or creates a pending shop, no product, queued on capture-admin", async () => {
    const before = t.calls.length;
    const res = await call("POST", "/captures/test", { url: "https://test-link-new.test/p/1?fbclid=1" });
    expect(res.status).toBe(202);
    const { captureId, shopId } = (await json(res)) as { captureId: string; shopId: string };
    const [shop] = await t.db.select().from(schema.shops).where(eq(schema.shops.id, shopId));
    expect(shop?.status).toBe("pending");
    const [capture] = await t.db.select().from(schema.captures).where(eq(schema.captures.id, captureId));
    expect(capture).toMatchObject({ trigger: "admin_test", productId: null, url: "https://test-link-new.test/p/1" });
    expect(t.calls.slice(before)).toEqual([{ queue: "capture-admin", id: captureId }]);
    expect((await call("POST", "/captures/test", { url: "ftp://x" })).status).toBe(400);
  });

  it("reads a capture", async () => {
    const shop = await newShop();
    const c = await newCapture(shop.id, { method: "jsonld", durationMs: 420, result: { name: "Robe" } });
    const res = await call("GET", `/captures/${c.id}`);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({
      id: c.id,
      status: "succeeded",
      method: "jsonld",
      durationMs: 420,
      result: { name: "Robe" },
    });
    expect((await call("GET", `/captures/00000000-0000-4000-8000-000000000000`)).status).toBe(404);
  });

  it("lists failures newest first, with filters", async () => {
    await t.db.delete(schema.captures);
    const shop = await newShop({ name: "Failing" });
    const other = await newShop({ name: "Other" });
    const product = await newProduct(shop.id, ago(DAY));
    const f1 = await newCapture(shop.id, {
      status: "failed",
      errorCode: "timeout",
      createdAt: ago(3 * HOUR),
      productId: product.id,
    });
    const f2 = await newCapture(shop.id, {
      status: "failed",
      errorCode: "blocked",
      httpStatus: 403,
      createdAt: ago(HOUR),
    });
    await newCapture(other.id, { status: "failed", errorCode: "timeout", createdAt: ago(2 * HOUR) });
    await newCapture(shop.id, { status: "succeeded" });
    const all = await json(await call("GET", "/captures/failures"));
    expect(all.failures).toHaveLength(3);
    expect(all.failures[0]).toMatchObject({
      id: f2.id,
      shopName: "Failing",
      errorCode: "blocked",
      httpStatus: 403,
      trigger: "user",
    });
    const byShop = await json(await call("GET", `/captures/failures?shopId=${shop.id}`));
    expect(byShop.failures.map((f: { id: string }) => f.id)).toEqual([f2.id, f1.id]);
    expect(byShop.failures[1].productId).toBe(product.id);
    const byCode = await json(await call("GET", `/captures/failures?errorCode=timeout`));
    expect(byCode.failures).toHaveLength(2);
    expect((await call("GET", "/captures/failures?errorCode=zzz")).status).toBe(400);
  });

  it("retries into a new capture with the same trigger, product, shop and address", async () => {
    const shop = await newShop();
    const product = await newProduct(shop.id, ago(DAY));
    const user = await newCapture(shop.id, {
      status: "failed",
      errorCode: "timeout",
      productId: product.id,
      url: "https://r.test/a",
    });
    const monitor = await newCapture(shop.id, { status: "failed", trigger: "monitor", url: "https://r.test/m" });
    const before = t.calls.length;
    const r1 = await call("POST", `/captures/${user.id}/retry`, {});
    expect(r1.status).toBe(202);
    const id1 = ((await json(r1)) as { captureId: string }).captureId;
    const r2 = await call("POST", `/captures/${monitor.id}/retry`, {});
    const id2 = ((await json(r2)) as { captureId: string }).captureId;
    expect(t.calls.slice(before)).toEqual([
      { queue: "capture-user", id: id1 },
      { queue: "capture-admin", id: id2 },
    ]);
    const [n1] = await t.db.select().from(schema.captures).where(eq(schema.captures.id, id1));
    expect(n1).toMatchObject({
      trigger: "user",
      productId: product.id,
      shopId: shop.id,
      url: "https://r.test/a",
      status: "queued",
    });
    expect(n1?.id).not.toBe(user.id);
    expect((await call("POST", `/captures/00000000-0000-4000-8000-000000000000/retry`, {})).status).toBe(404);
    const active = await newCapture(shop.id, { status: "running" });
    const refused = await call("POST", `/captures/${active.id}/retry`, {});
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "capture_active" });
  });

  it("marks the capture failed with queue_unavailable when the queue is down", async () => {
    const shop = await newShop();
    const c = await newCapture(shop.id, { status: "failed", url: "https://q.test/a" });
    const original = t.queue.enqueue;
    t.queue.enqueue = async () => {
      throw new Error("down");
    };
    try {
      const res = await call("POST", `/captures/${c.id}/retry`, {});
      expect(res.status).toBe(500);
    } finally {
      t.queue.enqueue = original;
    }
    const rows = await t.db.select().from(schema.captures).where(eq(schema.captures.shopId, shop.id));
    expect(rows.find((r) => r.id !== c.id)).toMatchObject({ status: "failed", errorCode: "queue_unavailable" });
  });
});

describe("GET /api/admin/overview (catalog figures)", () => {
  it("counts captures, rate, methods, median duration and shops on a known set", async () => {
    await t.db.delete(schema.captures);
    await t.db.update(schema.shops).set({ mergedIntoId: null });
    await t.db.delete(schema.products);
    await t.db.delete(schema.shopDomains);
    await t.db.delete(schema.shops);
    const pending = await newShop({ status: "pending" });
    await newShop({ status: "pending", mergedIntoId: pending.id }); // merged: not counted
    const down = await newShop({ status: "published" });
    const fine = await newShop({ status: "published" });
    const fin = (h: number) => ({ createdAt: ago(h * HOUR), finishedAt: ago(h * HOUR) });
    // recent (24h): 2 succeeded (shopify 100, jsonld 300), 1 failed
    await newCapture(fine.id, { method: "shopify", durationMs: 100, ...fin(1) });
    await newCapture(fine.id, { method: "jsonld", durationMs: 300, ...fin(2) });
    await newCapture(fine.id, { status: "failed", errorCode: "timeout", ...fin(3) });
    await newCapture(fine.id, { status: "queued", createdAt: ago(HOUR) }); // not finished
    // not real fetch attempts: counted in last24h/last7d only
    await newCapture(fine.id, { method: null, durationMs: 1, ...fin(1) }); // 24 h reuse
    await newCapture(fine.id, { status: "failed", errorCode: "queue_unavailable", ...fin(1) });
    // 7 days: opengraph 500 succeeded, 1 failed (monitor, makes `down` with the next)
    await newCapture(fine.id, { method: "opengraph", durationMs: 500, ...fin(3 * 24) });
    await newCapture(down.id, { trigger: "monitor", status: "failed", errorCode: "blocked", ...fin(48) });
    await newCapture(down.id, { trigger: "monitor", status: "failed", errorCode: "blocked", ...fin(5 * 24) });
    // older than 7 days: ignored everywhere but not a problem
    await newCapture(fine.id, { method: "shopify", durationMs: 9000, ...fin(10 * 24) });

    const admin = await call("GET", "/overview");
    const body = adminOverviewSchema.parse(await admin.json());
    expect(body.captures).toEqual({
      last24h: 6, // 3 finished + 1 queued + 1 reuse + 1 queue failure, created within 24h
      last7d: 9,
      successRate7d: 3 / 6,
      byMethod: { shopify: 1, jsonld: 1, opengraph: 1 },
      medianDurationMs: 300,
    });
    expect(body.shops).toEqual({ pending: 1, down: 1 });
  });

  it("gives null rate and median without finished captures", async () => {
    await t.db.delete(schema.captures);
    const body = adminOverviewSchema.parse(await (await call("GET", "/overview")).json());
    expect(body.captures).toEqual({
      last24h: 0,
      last7d: 0,
      successRate7d: null,
      byMethod: { shopify: 0, jsonld: 0, opengraph: 0 },
      medianDurationMs: null,
    });
  });
});

describe("« Shopify nous demande de ralentir » (stocks frais)", () => {
  it("shows the slow-down on the dashboard and every shop page while it lasts, and nothing once over", async () => {
    await t.db.delete(schema.crawlSlowdowns);
    const shop = await newShop({ platform: "shopify" });
    const overview = async () => adminOverviewSchema.parse(await (await call("GET", "/overview")).json());
    const detail = async () => adminShopDetailSchema.parse(await (await call("GET", `/shops/${shop.id}`)).json());
    expect((await overview()).shopifySlowdown).toBeNull();
    expect((await detail()).shopifySlowdown).toBeNull();

    await recordShopifyRejection(t.db, ago(HOUR));
    const doubled = { level: "doubled", until: new Date(NOW.getTime() + 5 * HOUR).toISOString() };
    expect((await overview()).shopifySlowdown).toEqual(doubled);
    expect((await detail()).shopifySlowdown).toEqual(doubled);

    // Over (6 h after the 429): nothing shown.
    await t.db.update(schema.crawlSlowdowns).set({ until: ago(1) });
    expect((await overview()).shopifySlowdown).toBeNull();
    await t.db.delete(schema.crawlSlowdowns);
  });
});

describe("stocks frais: the dashboard's figures", () => {
  it("leaves sheet refreshes out of the capture figures, the shop's health and its recent errors", async () => {
    await t.db.delete(schema.captures);
    const shop = await newShop({ status: "published" });
    const fin = { createdAt: ago(HOUR), finishedAt: ago(HOUR) };
    await newCapture(shop.id, { method: "shopify", durationMs: 100, ...fin });
    await newCapture(shop.id, { trigger: "refresh", method: "shopify", durationMs: 100, ...fin });
    await newCapture(shop.id, { trigger: "refresh", status: "failed", errorCode: "timeout", ...fin });
    await newCapture(shop.id, { trigger: "refresh", status: "failed", errorCode: "blocked", ...fin });

    const body = adminOverviewSchema.parse(await (await call("GET", "/overview")).json());
    expect(body.captures).toMatchObject({ last24h: 1, last7d: 1, successRate7d: 1 });
    const detail = adminShopDetailSchema.parse(await (await call("GET", `/shops/${shop.id}`)).json());
    expect(detail.successRate7d).toBe(1);
    expect(detail.recentErrors).toEqual([]);
  });

  it("« Relecture en retard » counts the due shops waiting more than twice their interval", async () => {
    await t.db.update(schema.shops).set({ importEnabled: false });
    const late = { status: "published" as const, platform: "shopify" as const, importEnabled: true };
    const overview = async () => adminOverviewSchema.parse(await (await call("GET", "/overview")).json()).rereadLate;
    expect(await overview()).toBe(0);
    await newShop({ ...late, importStartedAt: ago(90 * 60_000) }); // due, not late
    await newShop({ ...late, importStartedAt: ago(3 * HOUR) }); // late (> 2 h)
    await newShop({ ...late, importStartedAt: ago(5 * HOUR), lastImportSeen: 9000 }); // big shop: 6 h
    await newShop({ ...late, importStartedAt: ago(7 * HOUR), lastImportSeen: 9000 }); // late
    await newShop({ ...late, importStartedAt: ago(9 * HOUR), importState: "running", importHeartbeatAt: ago(60_000) });
    await newShop({ ...late, status: "pending", importStartedAt: ago(9 * HOUR) });
    expect(await overview()).toBe(2);
    // Doubled: 4 h and 12 h.
    await recordShopifyRejection(t.db, ago(HOUR));
    expect(await overview()).toBe(0);
    await t.db.delete(schema.crawlSlowdowns);
    await t.db.update(schema.shops).set({ importEnabled: false });
  });
});

describe("audit", () => {
  it("journals every admin mutation", async () => {
    await t.db.delete(schema.adminAuditLog);
    const a = await newShop({}, ["audit-a.test"]);
    const b = await newShop({}, ["audit-b.test"]);
    const captureOf = await newCapture(a.id, { status: "failed" });
    await call("PATCH", `/shops/${a.id}`, { name: "Audited" });
    await call("POST", "/shops", { url: "https://audit-new.test/p" });
    await call("POST", "/captures/test", { url: "https://audit-test.test/p" });
    await call("POST", `/captures/${captureOf.id}/retry`, {});
    await call("POST", `/shops/${a.id}/merge`, { targetId: b.id });
    const rows = await t.db.select().from(schema.adminAuditLog);
    expect(rows.map((r) => r.action).sort()).toEqual(
      ["capture.retry", "capture.test", "shop.create", "shop.merge", "shop.update"].sort(),
    );
    expect(rows.find((r) => r.action === "shop.merge")?.target).toBe(`shop:${a.id}`);
  });
});
