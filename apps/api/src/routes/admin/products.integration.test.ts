import { eq, schema } from "@closyria/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let adminCookie: string;
let adminId: string;
let userCookie: string;
let counter = 0;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness();
  const admin = await t.signIn();
  await t.db.update(schema.user).set({ role: "admin", isAnonymous: false }).where(eq(schema.user.id, admin.userId));
  await t.db.update(schema.session).set({ authMethod: "passkey" }).where(eq(schema.session.userId, admin.userId));
  adminCookie = admin.cookie;
  adminId = admin.userId;
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
// biome-ignore lint/suspicious/noExplicitAny: loose reader of JSON answers in tests
const json = async (res: Response) => (await res.json()) as Record<string, any>;

async function newShop() {
  const n = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `PShop ${n}`, slug: `padm-shop-${n}` })
    .returning();
  if (!shop) throw new Error("no shop");
  return shop;
}

async function newProduct(shopId: string, values: Partial<typeof schema.products.$inferInsert> = {}) {
  const n = ++counter;
  const [p] = await t.db
    .insert(schema.products)
    .values({ shopId, canonicalUrl: `https://padm.test/${n}`, name: `Product ${n}`, ...values })
    .returning();
  if (!p) throw new Error("no product");
  return p;
}

async function keep(userId: string, productId: string, deletedAt: Date | null = null) {
  const [profile] = await t.db
    .insert(schema.profiles)
    .values({ userId, name: "Moi", audience: "women", color: "plum" })
    .returning();
  if (!profile) throw new Error("no profile");
  await t.db.insert(schema.items).values({ userId, profileId: profile.id, productId, deletedAt });
}

describe("admin products", () => {
  it("answers 403 to a non-admin and 401 to nobody on every route", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const routes: [string, string, unknown?][] = [
      ["GET", "/products"],
      ["GET", `/products/${id}`],
      ["PATCH", `/products/${id}`, { name: "x" }],
      ["POST", `/products/${id}/recapture`],
    ];
    for (const [method, path, body] of routes) {
      expect((await call(method, path, body, userCookie)).status, `${method} ${path}`).toBe(403);
      expect((await call(method, path, body, "")).status, `${method} ${path}`).toBe(401);
    }
  });

  it("counts the active items per product without exposing any user or item id", async () => {
    const shop = await newShop();
    const product = await newProduct(shop.id, { name: "Counted dress" });
    const a = await t.signIn();
    const b = await t.signIn();
    const c = await t.signIn();
    await keep(a.userId, product.id);
    await keep(b.userId, product.id);
    await keep(c.userId, product.id, new Date()); // in the trash: not counted

    const list = await call("GET", `/products?q=counted%20dress`);
    expect(list.status).toBe(200);
    const body = await json(list);
    expect(body.products).toHaveLength(1);
    expect(body.products[0].keptBy).toBe(2);
    const detail = await json(await call("GET", `/products/${product.id}`));
    expect(detail.keptBy).toBe(2);

    const raw = JSON.stringify([body, detail]);
    for (const id of [a.userId, b.userId, c.userId]) expect(raw).not.toContain(id);
    expect(raw).not.toMatch(/userId|profileId|itemId/);
    const items = await t.db.select().from(schema.items).where(eq(schema.items.productId, product.id));
    for (const item of items) expect(raw).not.toContain(item.id);
  });

  it("shows the sheet in full: shop data, dates, photos and sizes", async () => {
    const shop = await newShop();
    const published = new Date("2026-03-01T10:00:00Z");
    const product = await newProduct(shop.id, {
      publishedAt: published,
      gtin: "3760000000000",
      sku: "SKU-1",
      shopData: { breadcrumb: ["Femme", "Robes"] },
      lastCapturedAt: new Date("2026-11-01T00:00:00Z"),
    });
    await t.db.insert(schema.productImages).values({
      productId: product.id,
      position: 0,
      key: "k",
      width: 10,
      height: 20,
      sourceHash: "h",
    });
    await t.db.insert(schema.productSizes).values({ productId: product.id, label: "M", position: 0, available: true });
    const detail = await json(await call("GET", `/products/${product.id}`));
    expect(detail).toMatchObject({
      shopName: shop.name,
      gtin: "3760000000000",
      sku: "SKU-1",
      shopData: { breadcrumb: ["Femme", "Robes"] },
      publishedAt: published.toISOString(),
      lastCapturedAt: "2026-11-01T00:00:00.000Z",
      keptBy: 0,
      sizes: [{ label: "M", available: true, priceCents: null }],
    });
    expect(detail.images).toHaveLength(1);
    expect(detail.images[0].url).toMatch(/^\/api\/catalog-images\//);
    expect(detail.createdAt).toBeTruthy();
    expect(detail.updatedAt).toBeTruthy();
    expect((await call("GET", "/products/00000000-0000-4000-8000-0000000000ff")).status).toBe(404);
  });

  it("searches by name (wildcards escaped), filters, and pages 50 at a time", async () => {
    const shopA = await newShop();
    const shopB = await newShop();
    await newProduct(shopA.id, { name: "100%_special" });
    await newProduct(shopA.id, { name: "1000 plain" });
    const literal = await json(await call("GET", `/products?q=${encodeURIComponent("100%_")}&shopId=${shopA.id}`));
    expect(literal.products.map((p: { name: string }) => p.name)).toEqual(["100%_special"]);

    const [category] = await t.db
      .insert(schema.categories)
      .values({ slug: `padm-cat-${++counter}`, name: "Cat" })
      .returning();
    const failed = await newProduct(shopB.id, { name: "Failed one", captureStatus: "failed" });
    const admin = await newProduct(shopB.id, { name: "Admin one", classifiedBy: "admin", categoryId: category?.id });
    const ruled = await newProduct(shopB.id, { name: "Ruled one", categoryId: category?.id });
    const ids = async (query: string) =>
      (await json(await call("GET", `/products?shopId=${shopB.id}&${query}`))).products.map(
        (p: { id: string }) => p.id,
      );
    expect(await ids("captureStatus=failed")).toEqual([failed.id]);
    expect(await ids("classified=admin")).toEqual([admin.id]);
    expect((await ids("classified=rule")).sort()).toEqual([failed.id, ruled.id].sort());
    expect(await ids("classified=none")).toEqual([failed.id]);

    const shopC = await newShop();
    const base = new Date("2026-10-01T00:00:00Z").getTime();
    await t.db.insert(schema.products).values(
      Array.from({ length: 120 }, (_, i) => ({
        shopId: shopC.id,
        canonicalUrl: `https://padm-bulk.test/${i}`,
        name: `Bulk ${i}`,
        createdAt: new Date(base + (i < 60 ? 0 : 1000)),
      })),
    );
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await json(
        await call("GET", `/products?shopId=${shopC.id}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
      );
      expect(page.products.length).toBeLessThanOrEqual(50);
      seen.push(...page.products.map((p: { id: string }) => p.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(120);
    expect((await call("GET", "/products?cursor=garbage")).status).toBe(400);
  });

  it("corrects a sheet, marks it admin-classified and journals it", async () => {
    const shop = await newShop();
    const product = await newProduct(shop.id, { categoryId: null });
    const [color] = await t.db.select().from(schema.colors).limit(1);
    await t.db.delete(schema.adminAuditLog);
    const res = await call("PATCH", `/products/${product.id}`, {
      name: "Corrected",
      brand: "Brand",
      priceCents: 1999,
      audience: "child",
      childDetail: "girl",
      colorId: color?.id ?? null,
      season: "summer",
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({
      name: "Corrected",
      brand: "Brand",
      priceCents: 1999,
      audience: "child",
      childDetail: "girl",
      season: "summer",
      classifiedBy: "admin",
    });
    const [row] = await t.db.select().from(schema.products).where(eq(schema.products.id, product.id));
    expect(row?.classifiedBy).toBe("admin");
    const audit = await t.db.select().from(schema.adminAuditLog);
    expect(audit.map((a) => [a.action, a.target, a.adminId])).toEqual([
      ["product.update", `product:${product.id}`, adminId],
    ]);

    // A child detail only goes with the child audience.
    const adult = await json(await call("PATCH", `/products/${product.id}`, { audience: "women" }));
    expect(adult.childDetail).toBeNull();
    expect((await call("PATCH", `/products/${product.id}`, { childDetail: "boy" })).status).toBe(400);
    // null clears the detail while the audience stays child.
    await call("PATCH", `/products/${product.id}`, { audience: "child", childDetail: "girl" });
    const cleared = await json(await call("PATCH", `/products/${product.id}`, { childDetail: null }));
    expect(cleared).toMatchObject({ audience: "child", childDetail: null });
    expect((await call("PATCH", `/products/${product.id}`, {})).status).toBe(400);
    expect((await call("PATCH", `/products/${product.id}`, { season: "spring" })).status).toBe(400);
    expect(
      (await call("PATCH", `/products/${product.id}`, { categoryId: "00000000-0000-4000-8000-0000000000ff" })).status,
    ).toBe(400);
    expect((await call("PATCH", "/products/00000000-0000-4000-8000-0000000000ff", { name: "x" })).status).toBe(404);
  });

  it("recapture queues an admin capture by the admin, refuses while one is active", async () => {
    const shop = await newShop();
    const product = await newProduct(shop.id);
    await t.db.delete(schema.adminAuditLog);
    t.calls.length = 0;
    const res = await call("POST", `/products/${product.id}/recapture`);
    expect(res.status).toBe(202);
    const { captureId } = await json(res);
    const [capture] = await t.db.select().from(schema.captures).where(eq(schema.captures.id, captureId));
    expect(capture).toMatchObject({
      productId: product.id,
      shopId: shop.id,
      url: product.canonicalUrl,
      trigger: "user",
      requestedBy: adminId,
      status: "queued",
    });
    expect(t.calls).toEqual([{ queue: "capture-admin", id: captureId }]);
    expect((await t.db.select().from(schema.adminAuditLog)).map((a) => a.action)).toEqual(["product.recapture"]);

    const again = await call("POST", `/products/${product.id}/recapture`);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "capture_active" });
    await t.db.update(schema.captures).set({ status: "failed" }).where(eq(schema.captures.id, captureId));
    expect((await call("POST", `/products/${product.id}/recapture`)).status).toBe(202);
    expect((await call("POST", "/products/00000000-0000-4000-8000-0000000000ff/recapture")).status).toBe(404);
  });
});
