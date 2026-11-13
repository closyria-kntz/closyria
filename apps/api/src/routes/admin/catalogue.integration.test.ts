import { and, eq, isNull, schema } from "@closyria/db";
import { catalogPageSchema } from "@closyria/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findOrCreateShop } from "../../catalog/shops";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";

// Catalogue « Découvrir », task 4: the admin of the catalogue (validate or refuse a shop, its values and import,
// « À classer », « Signalements »). Every mutation is journaled.

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let admin: { cookie: string; userId: string };
let user: { cookie: string; userId: string };
let reporter: { cookie: string; userId: string };
let counter = 0;
const NOW = new Date("2026-11-13T12:00:00Z");
let ref: { dresses: string; shoes: string; others: string; red: string; black: string };

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness({ now: () => NOW });
  admin = await t.signIn();
  await t.db.update(schema.user).set({ role: "admin", isAnonymous: false }).where(eq(schema.user.id, admin.userId));
  await t.db.update(schema.session).set({ authMethod: "passkey" }).where(eq(schema.session.userId, admin.userId));
  user = await t.signIn();
  reporter = await t.signIn();
  const cat = async (slug: string, name: string) => {
    const [row] = await t.db.insert(schema.categories).values({ slug, name }).returning();
    if (!row) throw new Error("no category");
    return row.id;
  };
  const color = async (slug: string, name: string) => {
    const [row] = await t.db.insert(schema.colors).values({ slug, name, hex: "#aa0000" }).returning();
    if (!row) throw new Error("no color");
    return row.id;
  };
  ref = {
    dresses: await cat("robes", "Robes"),
    shoes: await cat("chaussures", "Chaussures"),
    others: await cat("autres", "Autres"),
    red: await color("rouge", "Rouge"),
    black: await color("noir", "Noir"),
  };
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

beforeEach(async () => {
  await t.db.delete(schema.productReports);
  await t.db.delete(schema.itemEvents);
  await t.db.delete(schema.items);
  await t.db.delete(schema.profiles);
  await t.db.delete(schema.products);
  await t.db.delete(schema.shopDomains);
  await t.db.update(schema.shops).set({ mergedIntoId: null });
  await t.db.delete(schema.shops);
  await t.db.delete(schema.adminAuditLog);
  t.calls.length = 0;
});

function call(method: string, path: string, body?: unknown, cookie = admin.cookie) {
  return t.app.request(`/api${path}`, {
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

async function newShop(values: Partial<typeof schema.shops.$inferInsert> = {}, domain?: string) {
  const n = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `Shop ${n}`, slug: `adm-cat-${n}`, status: "published", platform: "shopify", ...values })
    .returning();
  if (!shop) throw new Error("no shop");
  await t.db.insert(schema.shopDomains).values({ domain: domain ?? `adm-cat-${n}.test`, shopId: shop.id });
  return shop;
}

type ProductOptions = Partial<typeof schema.products.$inferInsert> & { productType?: string };

/** A complete catalogue article (name, price, photo). */
async function newProduct(shopId: string, options: ProductOptions = {}) {
  const n = ++counter;
  const { productType, ...values } = options;
  const [p] = await t.db
    .insert(schema.products)
    .values({
      shopId,
      canonicalUrl: `https://adm-cat.test/${n}`,
      name: `Article ${n}`,
      priceCents: 5000,
      currency: "EUR",
      categoryId: ref.dresses,
      colorId: ref.red,
      ...(productType ? { shopData: { category: productType } } : {}),
      ...values,
    })
    .returning();
  if (!p) throw new Error("no product");
  await t.db.insert(schema.productImages).values({
    productId: p.id,
    position: 0,
    key: `products/${p.id}/${n}.webp`,
    width: 600,
    height: 800,
    sourceHash: `h${n}`,
  });
  return p;
}

async function catalogueIds(cookie = user.cookie) {
  const res = await call("GET", "/catalog", undefined, cookie);
  expect(res.status).toBe(200);
  return catalogPageSchema.parse(await res.json()).items.map((c) => c.productId);
}

async function productRow(id: string) {
  const [row] = await t.db.select().from(schema.products).where(eq(schema.products.id, id));
  if (!row) throw new Error("no product");
  return row;
}

async function shopRow(id: string) {
  const [row] = await t.db.select().from(schema.shops).where(eq(schema.shops.id, id));
  if (!row) throw new Error("no shop");
  return row;
}

const audit = () => t.db.select().from(schema.adminAuditLog);

describe("access", () => {
  it("refuses a non-admin on every route of the catalogue admin", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    const routes: [string, string, unknown?][] = [
      ["POST", `/admin/shops/${id}/publish`],
      ["POST", `/admin/shops/${id}/refuse`],
      ["POST", `/admin/shops/${id}/import`],
      ["GET", "/admin/catalogue/unclassified"],
      ["PATCH", `/admin/products/${id}/classification`, { categoryId: id, colorId: id }],
      ["GET", "/admin/catalogue/reports"],
      ["POST", `/admin/products/${id}/hide`],
      ["POST", `/admin/products/${id}/keep`],
      ["POST", `/admin/products/${id}/unhide`],
    ];
    for (const [method, path, body] of routes) {
      expect((await call(method, path, body, user.cookie)).status, `${method} ${path}`).toBe(403);
      expect((await call(method, path, body, "")).status, `${method} ${path}`).toBe(401);
    }
    expect(await audit()).toEqual([]);
  });
});

describe("validate or refuse a shop", () => {
  it("publishing a pending shop makes its articles visible in the catalogue, and is journaled", async () => {
    const shop = await newShop({ status: "pending" });
    const product = await newProduct(shop.id);
    expect(await catalogueIds()).not.toContain(product.id);

    const res = await call("POST", `/admin/shops/${shop.id}/publish`);
    expect(res.status).toBe(204);
    expect((await shopRow(shop.id)).status).toBe("published");
    expect(await catalogueIds()).toContain(product.id);
    expect(await audit()).toEqual([
      expect.objectContaining({ adminId: admin.userId, action: "shop.publish", target: `shop:${shop.id}` }),
    ]);
  });

  it("refusing a shop hides its articles but keeps them; a refused shop can be published again", async () => {
    const shop = await newShop({ status: "published" });
    const product = await newProduct(shop.id);
    expect(await catalogueIds()).toContain(product.id);

    expect((await call("POST", `/admin/shops/${shop.id}/refuse`)).status).toBe(204);
    expect((await shopRow(shop.id)).status).toBe("refused");
    expect(await catalogueIds()).not.toContain(product.id);
    expect((await productRow(product.id)).id).toBe(product.id);

    expect((await call("POST", `/admin/shops/${shop.id}/publish`)).status).toBe(204);
    expect((await shopRow(shop.id)).status).toBe("published");
    const actions = (await audit()).map((a) => a.action).sort();
    expect(actions).toEqual(["shop.publish", "shop.refuse"]);
  });

  it("publishes a draft, answers 404 for an unknown or merged shop", async () => {
    const draft = await newShop({ status: "draft" });
    expect((await call("POST", `/admin/shops/${draft.id}/publish`)).status).toBe(204);
    const merged = await newShop({ status: "pending", mergedIntoId: draft.id });
    expect((await call("POST", `/admin/shops/${merged.id}/publish`)).status).toBe(404);
    expect((await call("POST", `/admin/shops/${merged.id}/refuse`)).status).toBe(404);
    expect((await call("POST", "/admin/shops/00000000-0000-4000-8000-000000000000/publish")).status).toBe(404);
  });

  it("a new link to a refused shop leaves it refused", async () => {
    const shop = await newShop({ status: "refused" }, "refused-shop.test");
    const found = await findOrCreateShop(t.db, "https://www.refused-shop.test/products/robe");
    expect(found.id).toBe(shop.id);
    expect((await shopRow(shop.id)).status).toBe("refused");
  });

  it("lists and filters refused shops", async () => {
    const refused = await newShop({ status: "refused" });
    await newShop({ status: "pending" });
    const body = await json(await call("GET", "/admin/shops?status=refused"));
    expect(body.shops.map((s: { id: string }) => s.id)).toEqual([refused.id]);
  });
});

describe("values and import of a shop", () => {
  it("saves the values and the import switch, and shows them with the import state", async () => {
    const shop = await newShop({
      lastImportAt: new Date("2026-11-12T03:00:00Z"),
      lastImportError: "blocked (HTTP 429)",
    });
    await newProduct(shop.id);
    await newProduct(shop.id);
    // Out of « Découvrir »: not counted.
    await newProduct(shop.id, { removedAt: NOW });
    await newProduct(shop.id, { hiddenAt: NOW });
    await newProduct(shop.id, { priceCents: null });
    const bare = await newProduct(shop.id);
    await t.db.delete(schema.productImages).where(eq(schema.productImages.productId, bare.id));

    const res = await call("PATCH", `/admin/shops/${shop.id}`, {
      values: ["made_in_france", "eco", "eco"],
      importEnabled: true,
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ values: ["made_in_france", "eco"], importEnabled: true });
    const row = await shopRow(shop.id);
    expect(row.values).toEqual(["made_in_france", "eco"]);
    expect(row.importEnabled).toBe(true);

    const detail = await json(await call("GET", `/admin/shops/${shop.id}`));
    expect(detail).toMatchObject({
      values: ["made_in_france", "eco"],
      importEnabled: true,
      lastImportAt: "2026-11-12T03:00:00.000Z",
      lastImportError: "blocked (HTTP 429)",
      catalogueProducts: 2,
    });
    expect((await call("PATCH", `/admin/shops/${shop.id}`, { values: ["vegan"] })).status).toBe(400);
    expect(await audit()).toContainEqual(
      expect.objectContaining({
        action: "shop.update",
        details: expect.objectContaining({ fields: "values,importEnabled" }),
      }),
    );
  });

  it("queues an import of a Shopify shop now (singleton per shop), journaled; refuses another platform", async () => {
    const shop = await newShop({ platform: "shopify" });
    const res = await call("POST", `/admin/shops/${shop.id}/import`);
    expect(res.status).toBe(202);
    expect(await json(res)).toEqual({ queued: true });
    expect(t.calls).toEqual([{ queue: "catalogue-import", id: shop.id }]);
    expect(await audit()).toContainEqual(expect.objectContaining({ action: "shop.import", target: `shop:${shop.id}` }));

    const other = await newShop({ platform: "other" });
    const refused = await call("POST", `/admin/shops/${other.id}/import`);
    expect(refused.status).toBe(409);
    expect(await json(refused)).toEqual({ error: "not_shopify" });
    expect((await call("POST", "/admin/shops/00000000-0000-4000-8000-000000000000/import")).status).toBe(404);
    expect(t.calls).toHaveLength(1);
  });

  it("shows « En attente » once queued, the progress of a running import, and forgets a job dead for over 6 h", async () => {
    const shop = await newShop({ platform: "shopify" });
    const fresh = await json(await call("GET", `/admin/shops/${shop.id}`));
    expect(fresh).toMatchObject({
      importState: null,
      importStartedAt: null,
      importPages: 0,
      importSeen: 0,
      lastImportSeen: null,
      lastImportCreated: null,
      lastImportRemoved: null,
    });

    await call("POST", `/admin/shops/${shop.id}/import`);
    expect(await json(await call("GET", `/admin/shops/${shop.id}`))).toMatchObject({
      importState: "queued",
      importStartedAt: NOW.toISOString(),
    });
    // The list tags it too.
    const listed = (await json(await call("GET", "/admin/shops"))).shops.find((s: { id: string }) => s.id === shop.id);
    expect(listed.importState).toBe("queued");

    // The worker runs it: a second « Importer maintenant » leaves its progress alone.
    const started = new Date(NOW.getTime() - 60_000);
    await t.db
      .update(schema.shops)
      .set({ importState: "running", importStartedAt: started, importPages: 3, importSeen: 712 })
      .where(eq(schema.shops.id, shop.id));
    await call("POST", `/admin/shops/${shop.id}/import`);
    expect(await json(await call("GET", `/admin/shops/${shop.id}`))).toMatchObject({
      importState: "running",
      importStartedAt: started.toISOString(),
      importPages: 3,
      importSeen: 712,
    });

    // Started over 6 h ago: the job died, nothing is under way any more, and a new import replaces it. The figures
    // of the last complete import (« Terminé à … ») are never touched by queueing; the worker resets the live ones.
    const dead = new Date(NOW.getTime() - 6 * 3_600_000 - 1000);
    await t.db
      .update(schema.shops)
      .set({ importStartedAt: dead, lastImportSeen: 900, lastImportCreated: 12, lastImportRemoved: 3 })
      .where(eq(schema.shops.id, shop.id));
    expect((await json(await call("GET", `/admin/shops/${shop.id}`))).importState).toBeNull();
    await call("POST", `/admin/shops/${shop.id}/import`);
    expect(await json(await call("GET", `/admin/shops/${shop.id}`))).toMatchObject({
      importState: "queued",
      importStartedAt: NOW.toISOString(),
      lastImportSeen: 900,
      lastImportCreated: 12,
      lastImportRemoved: 3,
    });
  });

  it("leaves no « En attente » behind when the queue cannot take the import", async () => {
    const failing = await createCatalogHarness({
      now: () => NOW,
      queue: {
        enqueue: async () => {},
        importCatalogue: async () => {
          throw new Error("queue down");
        },
      },
    });
    try {
      const boss = await failing.signIn();
      await failing.db
        .update(schema.user)
        .set({ role: "admin", isAnonymous: false })
        .where(eq(schema.user.id, boss.userId));
      await failing.db
        .update(schema.session)
        .set({ authMethod: "passkey" })
        .where(eq(schema.session.userId, boss.userId));
      const [shop] = await failing.db
        .insert(schema.shops)
        .values({ name: "S", slug: "queue-down", status: "published", platform: "shopify" })
        .returning();
      if (!shop) throw new Error("no shop");
      const res = await failing.app.request(`/api/admin/shops/${shop.id}/import`, {
        method: "POST",
        headers: { origin: BASE_URL, cookie: boss.cookie },
      });
      expect(res.status).toBe(500);
      const [row] = await failing.db.select().from(schema.shops).where(eq(schema.shops.id, shop.id));
      expect(row?.importState).toBeNull();
    } finally {
      await failing.stop();
    }
  }, 60_000);

  it("refuses with 409 the import of a merged or refused shop; a pending or draft one may be imported", async () => {
    const target = await newShop({ platform: "shopify" });
    const merged = await newShop({ platform: "shopify", mergedIntoId: target.id });
    const refused = await newShop({ platform: "shopify", status: "refused" });
    for (const [shop, error] of [
      [merged, "merged"],
      [refused, "refused"],
    ] as const) {
      const res = await call("POST", `/admin/shops/${shop.id}/import`);
      expect(res.status).toBe(409);
      expect(await json(res)).toEqual({ error });
    }
    expect(t.calls).toEqual([]);
    for (const status of ["pending", "draft"] as const) {
      const preview = await newShop({ platform: "shopify", status });
      expect((await call("POST", `/admin/shops/${preview.id}/import`)).status).toBe(202);
    }
    expect(t.calls).toHaveLength(2);
  });
});

describe("« À classer »", () => {
  it("lists catalogue articles filed « Autres », without a category or without a colour", async () => {
    const shop = await newShop({ status: "published" });
    const importing = await newShop({ status: "pending", importEnabled: true });
    const pending = await newShop({ status: "pending" });
    const noCategory = await newProduct(shop.id, { categoryId: null, productType: "Robe" });
    const others = await newProduct(shop.id, { categoryId: ref.others });
    const noColor = await newProduct(importing.id, { colorId: null });
    await newProduct(shop.id); // filed
    await newProduct(shop.id, { categoryId: null, removedAt: NOW });
    await newProduct(shop.id, { categoryId: null, hiddenAt: NOW });
    await newProduct(pending.id, { categoryId: null }); // not in the catalogue
    const refused = await newShop({ status: "refused", importEnabled: true });
    await newProduct(refused.id, { categoryId: null }); // refused: never in the catalogue
    await newProduct(shop.id, { categoryId: null, priceCents: null }); // incomplete: no price
    const bare = await newProduct(shop.id, { categoryId: null }); // incomplete: no photo
    await t.db.delete(schema.productImages).where(eq(schema.productImages.productId, bare.id));

    const res = await call("GET", "/admin/catalogue/unclassified");
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.products.map((p: { id: string }) => p.id).sort()).toEqual(
      [noCategory.id, others.id, noColor.id].sort(),
    );
    expect(body.total).toBe(3);
    expect(body.products.find((p: { id: string }) => p.id === noCategory.id)).toMatchObject({
      shopId: shop.id,
      shopName: shop.name,
      productType: "Robe",
      categoryId: null,
      colorId: ref.red,
    });
  });

  it("files an article: category, colour and source admin, journaled", async () => {
    const shop = await newShop();
    const product = await newProduct(shop.id, { categoryId: null, colorId: null, productType: "Robe" });
    const sibling = await newProduct(shop.id, { categoryId: null, productType: "Robe" });

    const res = await call("PATCH", `/admin/products/${product.id}/classification`, {
      categoryId: ref.dresses,
      colorId: ref.black,
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ updated: 1 });
    expect(await productRow(product.id)).toMatchObject({
      categoryId: ref.dresses,
      colorId: ref.black,
      categorySource: "admin",
    });
    expect((await productRow(sibling.id)).categoryId).toBeNull();
    expect(await audit()).toContainEqual(
      expect.objectContaining({ action: "product.classify", target: `product:${product.id}` }),
    );
  });

  it("« Appliquer aux articles du même type » files the shop's articles of that type, never an admin's filing or correction", async () => {
    const shop = await newShop();
    const other = await newShop();
    const product = await newProduct(shop.id, { categoryId: null, colorId: null, productType: "Robe" });
    const sameType = await newProduct(shop.id, { categoryId: ref.others, colorId: null, productType: "Robe" });
    const sameTypeFiled = await newProduct(shop.id, { categoryId: ref.dresses, colorId: ref.red, productType: "Robe" });
    const byAdmin = await newProduct(shop.id, {
      categoryId: ref.shoes,
      colorId: ref.red,
      categorySource: "admin",
      productType: "Robe",
    });
    const correctedByAdmin = await newProduct(shop.id, {
      categoryId: ref.shoes,
      colorId: ref.red,
      classifiedBy: "admin",
      productType: "Robe",
    });
    const otherType = await newProduct(shop.id, { categoryId: null, productType: "Sac" });
    const otherShop = await newProduct(other.id, { categoryId: null, productType: "Robe" });

    const res = await call("PATCH", `/admin/products/${product.id}/classification`, {
      categoryId: ref.dresses,
      colorId: ref.black,
      applyToShopType: true,
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ updated: 3 });
    for (const id of [product.id, sameType.id, sameTypeFiled.id]) {
      expect(await productRow(id)).toMatchObject({
        categoryId: ref.dresses,
        colorId: ref.black,
        categorySource: "admin",
      });
    }
    expect(await productRow(byAdmin.id)).toMatchObject({ categoryId: ref.shoes, colorId: ref.red });
    expect(await productRow(correctedByAdmin.id)).toMatchObject({ categoryId: ref.shoes, colorId: ref.red });
    expect((await productRow(otherType.id)).categoryId).toBeNull();
    expect((await productRow(otherShop.id)).categoryId).toBeNull();
  });

  it("re-files an article an admin already filed when it is the target; without a product type it files only it", async () => {
    const shop = await newShop();
    const product = await newProduct(shop.id, { categoryId: ref.shoes, categorySource: "admin" });
    const untyped = await newProduct(shop.id, { categoryId: null });
    const res = await call("PATCH", `/admin/products/${product.id}/classification`, {
      categoryId: ref.dresses,
      colorId: ref.black,
      applyToShopType: true,
    });
    expect(await json(res)).toEqual({ updated: 1 });
    expect((await productRow(product.id)).categoryId).toBe(ref.dresses);
    expect((await productRow(untyped.id)).categoryId).toBeNull();
  });

  it("answers 400 for an unknown category or colour, 404 for an unknown article", async () => {
    const shop = await newShop();
    const product = await newProduct(shop.id, { categoryId: null });
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect(
      (await call("PATCH", `/admin/products/${product.id}/classification`, { categoryId: unknown, colorId: ref.red }))
        .status,
    ).toBe(400);
    expect((await productRow(product.id)).categoryId).toBeNull();
    expect(
      (await call("PATCH", `/admin/products/${unknown}/classification`, { categoryId: ref.dresses, colorId: ref.red }))
        .status,
    ).toBe(404);
  });
});

describe("« Signalements »", () => {
  async function report(productId: string, userId: string, reason: "not_fashion" | "shocking" | "other", at: Date) {
    await t.db.insert(schema.productReports).values({ productId, userId, reason, createdAt: at });
  }

  it("lists open reports per article: count, reasons and latest date", async () => {
    const shop = await newShop();
    const product = await newProduct(shop.id);
    const quiet = await newProduct(shop.id);
    await report(product.id, user.userId, "not_fashion", new Date("2026-11-10T10:00:00Z"));
    await report(product.id, reporter.userId, "shocking", new Date("2026-11-12T10:00:00Z"));
    await report(product.id, admin.userId, "not_fashion", new Date("2026-11-11T10:00:00Z"));
    await report(quiet.id, user.userId, "other", new Date("2026-11-09T10:00:00Z"));
    await t.db
      .update(schema.productReports)
      .set({ resolvedAt: NOW, resolution: "kept" })
      .where(eq(schema.productReports.productId, quiet.id));

    const res = await call("GET", "/admin/catalogue/reports");
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.reports).toEqual([
      {
        productId: product.id,
        name: product.name,
        shopId: shop.id,
        shopName: shop.name,
        imageUrl: expect.any(String),
        count: 3,
        reasons: [
          { reason: "not_fashion", count: 2 },
          { reason: "shocking", count: 1 },
        ],
        latestAt: "2026-11-12T10:00:00.000Z",
      },
    ]);
    // Who reported is never returned.
    expect(JSON.stringify(body)).not.toContain(user.userId);
  });

  it("« Masquer du catalogue » hides the article, closes its reports and never touches anyone's wishes", async () => {
    const shop = await newShop();
    const product = await newProduct(shop.id);
    const [profile] = await t.db
      .insert(schema.profiles)
      .values({ userId: user.userId, name: "Moi", audience: "women", color: "plum" })
      .returning();
    if (!profile) throw new Error("no profile");
    const [item] = await t.db
      .insert(schema.items)
      .values({ userId: user.userId, productId: product.id, profileId: profile.id })
      .returning();
    if (!item) throw new Error("no item");
    await report(product.id, reporter.userId, "shocking", new Date("2026-11-12T10:00:00Z"));
    expect(await catalogueIds()).toContain(product.id);

    const res = await call("POST", `/admin/products/${product.id}/hide`);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ resolved: 1 });
    expect((await productRow(product.id)).hiddenAt).toEqual(NOW);
    expect(await catalogueIds()).not.toContain(product.id);
    expect(await catalogueIds(reporter.cookie)).not.toContain(product.id);
    const [after] = await t.db.select().from(schema.items).where(eq(schema.items.id, item.id));
    expect(after).toEqual(item);
    const open = await t.db
      .select()
      .from(schema.productReports)
      .where(and(eq(schema.productReports.productId, product.id), isNull(schema.productReports.resolvedAt)));
    expect(open).toEqual([]);
    const [closed] = await t.db.select().from(schema.productReports);
    expect(closed).toMatchObject({ resolvedAt: NOW, resolution: "hidden" });
    expect((await json(await call("GET", "/admin/catalogue/reports"))).reports).toEqual([]);
    expect(await audit()).toContainEqual(
      expect.objectContaining({ action: "product.hide", target: `product:${product.id}` }),
    );
  });

  it("« Remettre dans le catalogue » brings a hidden article back, journaled; the hidden ones are listed", async () => {
    const shop = await newShop();
    const product = await newProduct(shop.id);
    const shown = await newProduct(shop.id);
    await report(product.id, reporter.userId, "shocking", new Date("2026-11-12T10:00:00Z"));
    await call("POST", `/admin/products/${product.id}/hide`);

    const hidden = await json(await call("GET", "/admin/products?catalogue=hidden"));
    expect(hidden.products.map((p: { id: string }) => p.id)).toEqual([product.id]);
    expect(await json(await call("GET", `/admin/products/${product.id}`))).toMatchObject({
      hiddenAt: NOW.toISOString(),
    });
    expect((await json(await call("GET", `/admin/products/${shown.id}`))).hiddenAt).toBeNull();

    const res = await call("POST", `/admin/products/${product.id}/unhide`);
    expect(res.status).toBe(204);
    expect((await productRow(product.id)).hiddenAt).toBeNull();
    expect(await catalogueIds()).toContain(product.id);
    // Its report stays closed.
    expect((await json(await call("GET", "/admin/catalogue/reports"))).reports).toEqual([]);
    expect(await audit()).toContainEqual(
      expect.objectContaining({ action: "product.unhide", target: `product:${product.id}` }),
    );
    expect((await call("POST", `/admin/products/${shown.id}/unhide`)).status).toBe(204);
    expect((await call("POST", "/admin/products/00000000-0000-4000-8000-000000000000/unhide")).status).toBe(404);
  });

  it("« Garder » closes the reports and leaves the article in the catalogue", async () => {
    const shop = await newShop();
    const product = await newProduct(shop.id);
    await report(product.id, reporter.userId, "other", new Date("2026-11-12T10:00:00Z"));

    const res = await call("POST", `/admin/products/${product.id}/keep`);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ resolved: 1 });
    expect((await productRow(product.id)).hiddenAt).toBeNull();
    expect(await catalogueIds()).toContain(product.id);
    const [closed] = await t.db.select().from(schema.productReports);
    expect(closed).toMatchObject({ resolvedAt: NOW, resolution: "kept" });
    expect((await json(await call("GET", "/admin/catalogue/reports"))).reports).toEqual([]);
    expect(await audit()).toContainEqual(
      expect.objectContaining({ action: "product.keep", target: `product:${product.id}` }),
    );
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect((await call("POST", `/admin/products/${unknown}/keep`)).status).toBe(404);
    expect((await call("POST", `/admin/products/${unknown}/hide`)).status).toBe(404);
  });
});
