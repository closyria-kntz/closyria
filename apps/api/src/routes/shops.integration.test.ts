import { eq, schema } from "@closyria/db";
import { shopDirectorySchema } from "@closyria/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../catalog/test-app";

// Refonte Boudoir, task 6: « Découvrir » lists the published shops Closyria knows and the « boutique de la semaine ».

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let adminCookie: string;
let userCookie: string;
let userId: string;
let counter = 0;
const NOW = new Date("2026-11-11T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const DAY = 24 * 3_600_000;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness({ now: () => NOW });
  const admin = await t.signIn();
  await t.db.update(schema.user).set({ role: "admin", isAnonymous: false }).where(eq(schema.user.id, admin.userId));
  await t.db.update(schema.session).set({ authMethod: "passkey" }).where(eq(schema.session.userId, admin.userId));
  adminCookie = admin.cookie;
  const user = await t.signIn();
  userCookie = user.cookie;
  userId = user.userId;
  await t.db
    .update(schema.user)
    .set({ name: "Camille Secrète", email: "camille.secrete@example.test", isAnonymous: false })
    .where(eq(schema.user.id, userId));
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

beforeEach(async () => {
  await t.db.delete(schema.adminAuditLog);
  await t.db.delete(schema.items);
  await t.db.delete(schema.products);
  await t.db.delete(schema.shopDomains);
  await t.db.update(schema.shops).set({ mergedIntoId: null });
  await t.db.delete(schema.shops);
});

function call(method: string, path: string, cookie: string) {
  return t.app.request(`/api${path}`, { method, headers: { origin: BASE_URL, ...(cookie ? { cookie } : {}) } });
}

async function newShop(values: Partial<typeof schema.shops.$inferInsert> = {}, domains?: string[]) {
  const n = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `Shop ${n}`, slug: `dir-shop-${n}`, status: "published", ...values })
    .returning();
  if (!shop) throw new Error("no shop");
  const list = domains ?? [`dir-${n}.test`];
  if (list.length > 0)
    await t.db.insert(schema.shopDomains).values(list.map((domain) => ({ domain, shopId: shop.id })));
  return shop;
}

/** A complete article (name, price); with `image` it is one « Découvrir » shows. */
async function newProduct(
  shopId: string,
  createdAt: Date,
  image = true,
  values: Partial<typeof schema.products.$inferInsert> = {},
) {
  const n = ++counter;
  const [p] = await t.db
    .insert(schema.products)
    .values({
      shopId,
      canonicalUrl: `https://p.test/${n}`,
      createdAt,
      // First seen when created: its put-online date (the newest goes by it, « Nouveautés » order).
      publishedAt: createdAt,
      publishedSource: "first_seen",
      name: `Article ${n}`,
      priceCents: 3000,
      currency: "EUR",
      ...values,
    })
    .returning();
  if (!p) throw new Error("no product");
  if (!image) return { product: p, imageId: null };
  const [img] = await t.db
    .insert(schema.productImages)
    .values({ productId: p.id, position: 0, key: `catalog/${n}.webp`, width: 600, height: 800, sourceHash: `h${n}` })
    .returning();
  return { product: p, imageId: img?.id ?? null };
}

async function directory(cookie = userCookie) {
  const res = await call("GET", "/shops", cookie);
  expect(res.status).toBe(200);
  const text = await res.text();
  return { text, body: shopDirectorySchema.parse(JSON.parse(text)) };
}

describe("GET /api/shops", () => {
  it("needs a session", async () => {
    expect((await call("GET", "/shops", "")).status).toBe(401);
  });

  it("lists only published shops that are not merged, the most articles first, then by name", async () => {
    const big = await newShop({ name: "Zélie" });
    const a = await newShop({ name: "Atelier" });
    const b = await newShop({ name: "Bohème" });
    await newShop({ name: "Pending", status: "pending" });
    await newShop({ name: "Draft", status: "draft" });
    await newShop({ name: "Merged", mergedIntoId: big.id });
    await newShop({ name: "No domain" }, []);
    for (let i = 0; i < 3; i++) await newProduct(big.id, ago(DAY));
    await newProduct(b.id, ago(DAY));
    await newProduct(a.id, ago(DAY));

    const { body } = await directory();
    expect(body.featured).toBeNull();
    expect(body.shops.map((s) => [s.name, s.itemCount])).toEqual([
      ["Zélie", 3],
      ["Atelier", 1],
      ["Bohème", 1],
    ]);
  });

  it("gives the main domain and one photo of the most recent product that has one", async () => {
    const shop = await newShop({ name: "Les Cœurs" }, ["www-les-coeurs.test", "lescoeurs.test"]);
    await newProduct(shop.id, ago(3 * DAY), true);
    const recent = await newProduct(shop.id, ago(DAY), true);
    await newProduct(shop.id, ago(0), false); // newest, no photo: not in « Découvrir »
    // Undated (already on sale at the shop's first import), but imported just now: after every dated one.
    await newProduct(shop.id, ago(0), true, { publishedAt: null, publishedSource: "unknown", shopRank: 0 });
    const bare = await newShop({ name: "Sans photo" });

    const { body } = await directory();
    const coeurs = body.shops.find((s) => s.id === shop.id);
    expect(coeurs).toEqual({
      id: shop.id,
      name: "Les Cœurs",
      domain: "lescoeurs.test",
      itemCount: 3,
      imageUrl: `/api/catalog-images/${recent.imageId}`,
    });
    expect(body.shops.find((s) => s.id === bare.id)?.imageUrl).toBeNull();
  });

  it("counts and pictures only what « Découvrir » shows: never a hidden, removed or incomplete article", async () => {
    const shop = await newShop({ name: "Les Cœurs", featuredAt: ago(DAY) });
    const other = await newShop({ name: "Atelier" });
    const shown = await newProduct(shop.id, ago(3 * DAY));
    await newProduct(shop.id, ago(0), true, { hiddenAt: ago(0) }); // newest, hidden by the admin
    await newProduct(shop.id, ago(DAY), true, { removedAt: ago(0) }); // gone from the shop
    await newProduct(shop.id, ago(2 * DAY), true, { priceCents: null }); // no price
    const otherShown = await newProduct(other.id, ago(3 * DAY));
    await newProduct(other.id, ago(0), true, { removedAt: ago(0) });

    const { body } = await directory();
    expect(body.featured).toMatchObject({
      id: shop.id,
      itemCount: 1,
      imageUrl: `/api/catalog-images/${shown.imageId}`,
    });
    expect(body.shops).toEqual([
      expect.objectContaining({ id: other.id, itemCount: 1, imageUrl: `/api/catalog-images/${otherShown.imageId}` }),
    ]);
  });

  it("puts forward one shop only: the published one featured most recently, out of the list", async () => {
    const older = await newShop({ name: "Older", featuredAt: ago(7 * DAY) });
    const newest = await newShop({ name: "Newest", featuredAt: ago(DAY) });
    await newShop({ name: "Draft featured", status: "draft", featuredAt: ago(0) });
    await newShop({ name: "Merged featured", mergedIntoId: older.id, featuredAt: ago(0) });

    const { body } = await directory();
    expect(body.featured?.id).toBe(newest.id);
    expect(body.shops.map((s) => s.name)).toEqual(["Older"]);
  });

  it("never lists nor features a « grande enseigne »", async () => {
    const big = await newShop({ name: "Zara", isMajorBrand: true, featuredAt: ago(0) });
    await newProduct(big.id, ago(DAY));
    const small = await newShop({ name: "Atelier", featuredAt: ago(DAY) });
    const other = await newShop({ name: "Bohème" });

    const { body } = await directory();
    expect(body.featured?.id).toBe(small.id);
    expect(body.shops.map((s) => s.id)).toEqual([other.id]);
  });

  it("never says who pasted the articles", async () => {
    const shop = await newShop({ name: "Les Cœurs" });
    const { product } = await newProduct(shop.id, ago(DAY), true);
    const [profile] = await t.db
      .insert(schema.profiles)
      .values({ userId, name: "Moi", audience: "women", color: "rose" })
      .returning();
    await t.db.insert(schema.items).values({ userId, profileId: profile?.id ?? "", productId: product.id });

    const { text, body } = await directory(adminCookie);
    expect(body.shops).toHaveLength(1);
    expect(Object.keys(body.shops[0] ?? {}).sort()).toEqual(["domain", "id", "imageUrl", "itemCount", "name"]);
    for (const secret of ["Camille", "camille.secrete", userId, "Moi"]) expect(text).not.toContain(secret);
  });
});

describe("POST/DELETE /api/admin/shops/{id}/feature", () => {
  it("is for admins only", async () => {
    const shop = await newShop();
    for (const method of ["POST", "DELETE"]) {
      expect((await call(method, `/admin/shops/${shop.id}/feature`, userCookie)).status).toBe(403);
      expect((await call(method, `/admin/shops/${shop.id}/feature`, "")).status).toBe(401);
    }
  });

  it("makes the shop the boutique de la semaine, then takes it off, and journals both", async () => {
    const before = await newShop({ name: "Before", featuredAt: ago(DAY) });
    const shop = await newShop({ name: "Les Cœurs" });

    expect((await call("POST", `/admin/shops/${shop.id}/feature`, adminCookie)).status).toBe(204);
    expect((await directory()).body.featured?.id).toBe(shop.id);
    const detail = (await (await call("GET", `/admin/shops/${shop.id}`, adminCookie)).json()) as { featured: boolean };
    expect(detail.featured).toBe(true);
    const other = (await (await call("GET", `/admin/shops/${before.id}`, adminCookie)).json()) as { featured: boolean };
    expect(other.featured).toBe(false);

    expect((await call("DELETE", `/admin/shops/${shop.id}/feature`, adminCookie)).status).toBe(204);
    // The one featured before comes back.
    expect((await directory()).body.featured?.id).toBe(before.id);
    const [row] = await t.db.select().from(schema.shops).where(eq(schema.shops.id, shop.id));
    expect(row?.featuredAt).toBeNull();

    const audit = await t.db.select().from(schema.adminAuditLog);
    expect(audit.map((r) => [r.action, r.target]).sort()).toEqual([
      ["shop.feature", `shop:${shop.id}`],
      ["shop.unfeature", `shop:${shop.id}`],
    ]);
  });

  it("refuses a « grande enseigne » (409 major_brand); ticking it takes a featured shop off the une", async () => {
    const big = await newShop({ isMajorBrand: true });
    const res = await call("POST", `/admin/shops/${big.id}/feature`, adminCookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "major_brand" });
    const [row] = await t.db.select().from(schema.shops).where(eq(schema.shops.id, big.id));
    expect(row?.featuredAt).toBeNull();

    const shop = await newShop({ featuredAt: ago(DAY) });
    const patch = await t.app.request(`/api/admin/shops/${shop.id}`, {
      method: "PATCH",
      headers: { origin: BASE_URL, cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ isMajorBrand: true }),
    });
    expect(patch.status).toBe(200);
    const [after] = await t.db.select().from(schema.shops).where(eq(schema.shops.id, shop.id));
    expect(after).toMatchObject({ isMajorBrand: true, featuredAt: null });
    // Unticking it does not put it back.
    await t.app.request(`/api/admin/shops/${shop.id}`, {
      method: "PATCH",
      headers: { origin: BASE_URL, cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ isMajorBrand: false }),
    });
    expect((await t.db.select().from(schema.shops).where(eq(schema.shops.id, shop.id)))[0]?.featuredAt).toBeNull();
  });

  it("refuses a shop that is not published (409) and an unknown or merged one (404)", async () => {
    const draft = await newShop({ status: "draft" });
    const target = await newShop();
    const merged = await newShop({ mergedIntoId: target.id });
    const res = await call("POST", `/admin/shops/${draft.id}/feature`, adminCookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_published" });
    expect((await call("POST", `/admin/shops/${merged.id}/feature`, adminCookie)).status).toBe(404);
    expect(
      (await call("DELETE", "/admin/shops/00000000-0000-4000-8000-000000000000/feature", adminCookie)).status,
    ).toBe(404);
    expect((await directory()).body.featured).toBeNull();
  });
});
