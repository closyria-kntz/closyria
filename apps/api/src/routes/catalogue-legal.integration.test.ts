import { eq, schema, sql } from "@closyria/db";
import {
  adminShopDetailSchema,
  adminUserDetailSchema,
  catalogDetailSchema,
  catalogPageSchema,
  productViewSchema,
  shopDirectorySchema,
} from "@closyria/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../catalog/test-app";

// Catalogue conforme au droit (docs/specs/2026-11-14-catalogue-conforme.md): who sees which article of « Découvrir »
// (public / « Testeuse » / admin × imported only / pasted / partner shop), never a shop's photo or text in a public
// answer for a shop without a listing agreement, and the admin's two switches (« Testeuse », « Accord »), journalised.

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
type Person = { cookie: string; userId: string };
let t: Harness;
let pub: Person;
let pasting: Person;
let tester: Person;
let admin: Person;
let counter = 0;
const NOW = new Date("2026-11-14T12:00:00Z");
const IMAGE_PATH = "/api/catalog-images/";
let ref: { dresses: string; red: string; linen: string };

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness({ now: () => NOW });
  pub = await t.signIn();
  pasting = await t.signIn();
  tester = await t.signIn();
  admin = await t.signIn();
  await t.db.update(schema.user).set({ isTester: true }).where(eq(schema.user.id, tester.userId));
  await t.db.update(schema.user).set({ role: "admin" }).where(eq(schema.user.id, admin.userId));
  await t.db.update(schema.session).set({ authMethod: "passkey" }).where(eq(schema.session.userId, admin.userId));
  const [dresses] = await t.db.insert(schema.categories).values({ slug: "robes", name: "Robes" }).returning();
  const [longDress] = await t.db
    .insert(schema.categories)
    .values({ slug: "robe-longue", name: "Robe longue", parentId: dresses?.id ?? null })
    .returning();
  const [red] = await t.db.insert(schema.colors).values({ slug: "rouge", name: "Rouge", hex: "#C62828" }).returning();
  const [linen] = await t.db.insert(schema.materials).values({ slug: "lin", name: "Lin" }).returning();
  if (!longDress || !red || !linen) throw new Error("no reference");
  ref = { dresses: longDress.id, red: red.id, linen: linen.id };
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

beforeEach(async () => {
  await t.db.delete(schema.captures);
  await t.db.delete(schema.itemEvents);
  await t.db.delete(schema.items);
  await t.db.delete(schema.profiles);
  await t.db.delete(schema.products);
  await t.db.delete(schema.shopDomains);
  await t.db.delete(schema.shops);
  await t.db.delete(schema.adminAuditLog);
});

function call(method: string, path: string, cookie: string, body?: unknown) {
  return t.app.request(`/api${path}`, {
    method,
    headers: {
      origin: BASE_URL,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function newShop(partner: boolean) {
  const n = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({
      name: `Boutique ${n}`,
      slug: `legal-shop-${n}`,
      status: "published",
      listingAgreementAt: partner ? new Date("2026-11-01T00:00:00Z") : null,
    })
    .returning();
  if (!shop) throw new Error("no shop");
  await t.db.insert(schema.shopDomains).values({ shopId: shop.id, domain: `legal-${n}.test` });
  return shop;
}

/** A complete article with a photo, a shop text, a category, a colour, a material and sizes. */
async function newProduct(shopId: string) {
  const n = ++counter;
  const [p] = await t.db
    .insert(schema.products)
    .values({
      shopId,
      canonicalUrl: `https://legal.test/${n}`,
      name: `Robe ${n}`,
      description: `Texte écrit par la boutique ${n}`,
      priceCents: 5000,
      currency: "EUR",
      categoryId: ref.dresses,
      colorId: ref.red,
      materialId: ref.linen,
      publishedAt: NOW,
      publishedSource: "shop",
      lastCapturedAt: NOW,
    })
    .returning();
  if (!p) throw new Error("no product");
  await t.db.insert(schema.productImages).values({
    productId: p.id,
    position: 0,
    key: `products/${p.id}/0.webp`,
    width: 600,
    height: 800,
    sourceHash: `h${n}`,
  });
  await t.db.insert(schema.productSizes).values([
    { productId: p.id, label: "36", available: true, position: 0 },
    { productId: p.id, label: "38", available: false, position: 1 },
    { productId: p.id, label: "42", available: true, position: 2 },
  ]);
  return p;
}

/** A link she pasted (null: a friend on a shared link): a user capture of the product, as the worker ends it. */
async function paste(
  productId: string,
  shopId: string,
  by: Person | null,
  trigger: "user" | "admin_recapture" = "user",
) {
  const [capture] = await t.db
    .insert(schema.captures)
    .values({
      productId,
      shopId,
      url: `https://legal.test/paste/${++counter}`,
      trigger,
      requestedBy: by?.userId ?? null,
      status: "queued",
    })
    .returning();
  // The worker's end of the capture: the publishing rule reads the success (migration 0035's trigger).
  await t.db
    .update(schema.captures)
    .set({ status: "succeeded" })
    .where(eq(schema.captures.id, capture?.id ?? ""));
}

async function pastedAt(productId: string) {
  const [row] = await t.db
    .select({ pastedAt: schema.products.pastedAt })
    .from(schema.products)
    .where(eq(schema.products.id, productId));
  return row?.pastedAt ?? null;
}

/** Her item on the product (a wish), with a profile of hers. */
async function want(productId: string, by: Person) {
  const [profile] = await t.db
    .insert(schema.profiles)
    .values({ userId: by.userId, name: "Moi", audience: "women", color: "plum" })
    .returning();
  await t.db.insert(schema.items).values({ userId: by.userId, productId, profileId: profile?.id ?? "" });
}

async function listed(who: Person) {
  const res = await call("GET", "/catalog", who.cookie);
  expect(res.status).toBe(200);
  const text = await res.text();
  return { text, page: catalogPageSchema.parse(JSON.parse(text)) };
}

/** The five kinds of articles of the matrix. */
async function seedMatrix() {
  const plain = await newShop(false);
  const partner = await newShop(true);
  const importedOnly = await newProduct(plain.id);
  const pasted = await newProduct(plain.id);
  await paste(pasted.id, plain.id, pasting);
  const keptByItem = await newProduct(plain.id);
  await want(keptByItem.id, pasting);
  // A « Testeuse » keeping an imported article does not make it public.
  const keptByTester = await newProduct(plain.id);
  await want(keptByTester.id, tester);
  const partnerImport = await newProduct(partner.id);
  return { plain, partner, importedOnly, pasted, keptByItem, keptByTester, partnerImport };
}

describe("visibility matrix", () => {
  it("public: pasted and partner articles only; testers and admins: everything", async () => {
    const m = await seedMatrix();
    const publicIds = (await listed(pub)).page.items.map((c) => c.productId).sort();
    expect(publicIds).toEqual([m.pasted.id, m.keptByItem.id, m.partnerImport.id].sort());
    const all = [m.importedOnly.id, m.pasted.id, m.keptByItem.id, m.keptByTester.id, m.partnerImport.id].sort();
    expect((await listed(tester)).page.items.map((c) => c.productId).sort()).toEqual(all);
    expect((await listed(admin)).page.items.map((c) => c.productId).sort()).toEqual(all);
  });

  it("an imported-only sheet is not found for the public, open for a tester and an admin", async () => {
    const m = await seedMatrix();
    expect((await call("GET", `/catalog/${m.importedOnly.id}`, pub.cookie)).status).toBe(404);
    expect((await call("POST", `/catalog/${m.importedOnly.id}/report`, pub.cookie, { reason: "other" })).status).toBe(
      404,
    );
    expect((await call("GET", `/catalog/${m.importedOnly.id}`, tester.cookie)).status).toBe(200);
    expect((await call("GET", `/catalog/${m.importedOnly.id}`, admin.cookie)).status).toBe(200);
  });

  it("a product first imported, then pasted by a user, becomes public", async () => {
    const shop = await newShop(false);
    const p = await newProduct(shop.id);
    expect((await listed(pub)).page.items).toHaveLength(0);
    await paste(p.id, shop.id, pasting);
    expect((await listed(pub)).page.items.map((c) => c.productId)).toEqual([p.id]);
    expect((await call("GET", `/catalog/${p.id}`, pub.cookie)).status).toBe(200);
  });

  it("the usual rules still apply on top: a hidden pasted article or a major brand stays out", async () => {
    const shop = await newShop(false);
    const hidden = await newProduct(shop.id);
    await paste(hidden.id, shop.id, pasting);
    await t.db.update(schema.products).set({ hiddenAt: NOW }).where(eq(schema.products.id, hidden.id));
    const major = await newShop(true);
    await t.db.update(schema.shops).set({ isMajorBrand: true }).where(eq(schema.shops.id, major.id));
    await newProduct(major.id);
    expect((await listed(pub)).page.items).toHaveLength(0);
    expect((await listed(admin)).page.items).toHaveLength(0);
  });
});

describe("who publishes a product (products.pasted_at)", () => {
  it("only someone neither admin nor tester: her paste or her item; a friend's paste too", async () => {
    const shop = await newShop(false);
    const byPublic = await newProduct(shop.id);
    await paste(byPublic.id, shop.id, pasting);
    const byFriend = await newProduct(shop.id);
    await paste(byFriend.id, shop.id, null);
    const byTester = await newProduct(shop.id);
    await paste(byTester.id, shop.id, tester);
    const byAdmin = await newProduct(shop.id);
    await paste(byAdmin.id, shop.id, admin);
    const keptByAdmin = await newProduct(shop.id);
    await want(keptByAdmin.id, admin);
    const publicIds = (await listed(pub)).page.items.map((c) => c.productId).sort();
    expect(publicIds).toEqual([byPublic.id, byFriend.id].sort());
    expect(await pastedAt(byTester.id)).toBeNull();
    expect(await pastedAt(byAdmin.id)).toBeNull();
    expect(await pastedAt(keptByAdmin.id)).toBeNull();
  });

  it("a capture still queued or failed publishes nothing; its success does", async () => {
    const shop = await newShop(false);
    const p = await newProduct(shop.id);
    const [capture] = await t.db
      .insert(schema.captures)
      .values({
        productId: p.id,
        shopId: shop.id,
        url: "https://legal.test/q",
        trigger: "user",
        requestedBy: pasting.userId,
      })
      .returning();
    expect(await pastedAt(p.id)).toBeNull();
    await t.db
      .update(schema.captures)
      .set({ status: "failed" })
      .where(eq(schema.captures.id, capture?.id ?? ""));
    expect(await pastedAt(p.id)).toBeNull();
    await paste(p.id, shop.id, pasting);
    expect(await pastedAt(p.id)).not.toBeNull();
  });

  it("the admin's « Recapturer » never publishes, through the route or its trigger", async () => {
    const shop = await newShop(false);
    const p = await newProduct(shop.id);
    const res = await call("POST", `/admin/products/${p.id}/recapture`, admin.cookie);
    expect(res.status).toBe(202);
    const [capture] = await t.db.select().from(schema.captures).where(eq(schema.captures.productId, p.id));
    expect(capture?.trigger).toBe("admin_recapture");
    await t.db.update(schema.captures).set({ status: "succeeded" }).where(eq(schema.captures.productId, p.id));
    await paste(p.id, shop.id, pasting, "admin_recapture");
    expect(await pastedAt(p.id)).toBeNull();
    expect((await listed(pub)).page.items).toHaveLength(0);
  });

  it("is never cleared, and a tester's earlier items stay unpublished when she stops testing", async () => {
    const shop = await newShop(false);
    const kept = await newProduct(shop.id);
    const someone = await t.signIn();
    await t.db.update(schema.user).set({ isTester: true }).where(eq(schema.user.id, someone.userId));
    await want(kept.id, someone);
    await t.db.update(schema.user).set({ isTester: false }).where(eq(schema.user.id, someone.userId));
    expect(await pastedAt(kept.id)).toBeNull();
    const p = await newProduct(shop.id);
    await want(p.id, pasting);
    const first = await pastedAt(p.id);
    expect(first).not.toBeNull();
    await t.db.delete(schema.items).where(eq(schema.items.productId, p.id));
    await paste(p.id, shop.id, pasting);
    expect(await pastedAt(p.id)).toEqual(first);
  });

  it("an admin counts only in a passkey session, like in the admin area", async () => {
    const shop = await newShop(false);
    await newProduct(shop.id);
    const otp = await t.signIn();
    await t.db.update(schema.user).set({ role: "admin" }).where(eq(schema.user.id, otp.userId));
    await t.db.update(schema.session).set({ authMethod: "email-otp" }).where(eq(schema.session.userId, otp.userId));
    expect((await listed(otp)).page.items).toHaveLength(0);
    expect((await listed(admin)).page.items).toHaveLength(1);
  });
});

describe("no shop photo nor shop text in public answers for shops without an agreement", () => {
  it("cards: an illustration (kind, colour) instead of the photo; partner cards keep it", async () => {
    const m = await seedMatrix();
    const { page } = await listed(pub);
    const byId = new Map(page.items.map((c) => [c.productId, c]));
    expect(byId.get(m.pasted.id)?.imageUrl).toBeNull();
    expect(byId.get(m.pasted.id)?.illustration).toEqual({ kind: "dress", color: "#C62828" });
    expect(byId.get(m.partnerImport.id)?.imageUrl).toMatch(IMAGE_PATH);
    // Testers see the photos of every article.
    const testerCards = (await listed(tester)).page.items;
    expect(testerCards.every((c) => c.imageUrl?.startsWith(IMAGE_PATH))).toBe(true);
  });

  it("no image address of a non-partner product anywhere in a public catalogue answer", async () => {
    const m = await seedMatrix();
    const nonPartnerImages = await t.db
      .select({ id: schema.productImages.id })
      .from(schema.productImages)
      .innerJoin(schema.products, eq(schema.products.id, schema.productImages.productId))
      .where(eq(schema.products.shopId, m.plain.id));
    const texts = [
      (await listed(pub)).text,
      await (await call("GET", `/catalog/${m.pasted.id}`, pub.cookie)).text(),
      await (await call("GET", `/catalog/${m.partnerImport.id}`, pub.cookie)).text(),
      await (await call("GET", "/shops", pub.cookie)).text(),
    ];
    for (const text of texts) {
      for (const { id } of nonPartnerImages) expect(text).not.toContain(id);
      for (const p of [m.importedOnly, m.pasted, m.keptByItem, m.keptByTester]) {
        expect(text).not.toContain(p.description);
      }
    }
  });

  it("the sheet: no photo, a factual sentence; partner: photos and the shop's text", async () => {
    const m = await seedMatrix();
    const sheet = catalogDetailSchema.parse(await (await call("GET", `/catalog/${m.pasted.id}`, pub.cookie)).json());
    expect(sheet.images).toEqual([]);
    expect(sheet.imageUrl).toBeNull();
    // 38 is sold out between 36 and 42: the sizes are listed, never a range over the gap.
    expect(sheet.description).toBe("Robe longue rouge en lin, tailles 36 et 42.");
    // « De la même boutique »: the other public article of the shop, illustrated too.
    expect(sheet.sameShop.map((c) => c.productId)).toEqual([m.keptByItem.id]);
    expect(sheet.sameShop.every((c) => c.imageUrl === null)).toBe(true);
    expect(sheet.sameStyle.map((c) => c.productId)).toEqual([m.partnerImport.id]);
    expect(sheet.sameStyle[0]?.imageUrl).toMatch(IMAGE_PATH);

    const partner = catalogDetailSchema.parse(
      await (await call("GET", `/catalog/${m.partnerImport.id}`, pub.cookie)).json(),
    );
    expect(partner.images).toHaveLength(1);
    expect(partner.description).toBe(m.partnerImport.description);

    const asTester = catalogDetailSchema.parse(
      await (await call("GET", `/catalog/${m.importedOnly.id}`, tester.cookie)).json(),
    );
    expect(asTester.images).toHaveLength(1);
    expect(asTester.description).toBe(m.importedOnly.description);
  });

  it("the shops' tiles: a photo only for a partner shop; counts only what she can see", async () => {
    const m = await seedMatrix();
    const directory = shopDirectorySchema.parse(await (await call("GET", "/shops", pub.cookie)).json());
    const tiles = new Map(
      [...directory.shops, ...(directory.featured ? [directory.featured] : [])].map((s) => [s.id, s]),
    );
    expect(tiles.get(m.plain.id)).toMatchObject({ imageUrl: null, itemCount: 2 });
    expect(tiles.get(m.partner.id)?.imageUrl).toMatch(IMAGE_PATH);
    const asAdmin = shopDirectorySchema.parse(await (await call("GET", "/shops", admin.cookie)).json());
    const plainTile = asAdmin.shops.find((s) => s.id === m.plain.id);
    expect(plainTile?.itemCount).toBe(4);
    expect(plainTile?.imageUrl).toMatch(IMAGE_PATH);
  });

  it("a product page: photos and text only for her own article, a partner shop, or a tester", async () => {
    const m = await seedMatrix();
    const view = async (productId: string, who: Person | null) =>
      productViewSchema.parse(await (await call("GET", `/products/${productId}`, who?.cookie ?? "")).json());
    await t.db
      .update(schema.products)
      .set({ shopData: { details: [{ label: "Composition", value: "Écrit par la boutique" }] } })
      .where(eq(schema.products.id, m.pasted.id));
    // Someone else's paste: neither photo, nor text, nor attributes table.
    expect((await view(m.pasted.id, pub)).images).toEqual([]);
    expect((await view(m.pasted.id, pub)).description).toBeNull();
    expect((await view(m.pasted.id, pub)).details).toEqual([]);
    expect((await view(m.pasted.id, pasting)).details).toEqual([
      { label: "Composition", value: "Écrit par la boutique" },
    ]);
    expect((await view(m.pasted.id, null)).images).toEqual([]);
    // Her own paste, her own item: unchanged.
    expect((await view(m.pasted.id, pasting)).images).toHaveLength(1);
    expect((await view(m.keptByItem.id, pasting)).description).toBe(m.keptByItem.description);
    expect((await view(m.partnerImport.id, pub)).images).toHaveLength(1);
    expect((await view(m.importedOnly.id, tester)).images).toHaveLength(1);
  });
});

describe("admin switches", () => {
  it("« Testeuse » on a person: read, switched, journalised, and it opens the imported articles", async () => {
    const shop = await newShop(false);
    const p = await newProduct(shop.id);
    const read = async () =>
      adminUserDetailSchema.parse(await (await call("GET", `/admin/users/${pub.userId}`, admin.cookie)).json());
    expect((await read()).isTester).toBe(false);
    expect((await call("PATCH", `/admin/users/${pub.userId}`, pub.cookie, { isTester: true })).status).toBe(403);
    const res = await call("PATCH", `/admin/users/${pub.userId}`, admin.cookie, { isTester: true });
    expect(res.status).toBe(200);
    expect(adminUserDetailSchema.parse(await res.json()).isTester).toBe(true);
    expect((await listed(pub)).page.items.map((c) => c.productId)).toEqual([p.id]);
    expect((await call("PATCH", `/admin/users/${pub.userId}`, admin.cookie, { isTester: false })).status).toBe(200);
    expect((await listed(pub)).page.items).toHaveLength(0);
    const audit = await t.db
      .select()
      .from(schema.adminAuditLog)
      .where(eq(schema.adminAuditLog.target, `user:${pub.userId}`));
    const notes = audit.map((a) => [a.action, (a.details as { isTester?: boolean }).isTester]);
    expect(notes).toHaveLength(2);
    expect(notes).toEqual(
      expect.arrayContaining([
        ["user.tester", true],
        ["user.tester", false],
      ]),
    );
    expect((await call("PATCH", "/admin/users/nobody", admin.cookie, { isTester: true })).status).toBe(404);
  });

  it("« Accord de référencement » on a shop: a day, journalised, and its imports become public", async () => {
    const shop = await newShop(false);
    const p = await newProduct(shop.id);
    expect((await listed(pub)).page.items).toHaveLength(0);
    const res = await call("PATCH", `/admin/shops/${shop.id}`, admin.cookie, { listingAgreementAt: "2026-11-10" });
    expect(res.status).toBe(200);
    expect(adminShopDetailSchema.partial().parse(await res.json()).listingAgreementAt).toBe("2026-11-10T00:00:00.000Z");
    const card = (await listed(pub)).page.items[0];
    expect(card?.productId).toBe(p.id);
    expect(card?.imageUrl).toMatch(IMAGE_PATH);
    expect(
      (await call("PATCH", `/admin/shops/${shop.id}`, admin.cookie, { listingAgreementAt: "2999-01-01" })).status,
    ).toBe(400);
    expect((await call("PATCH", `/admin/shops/${shop.id}`, admin.cookie, { listingAgreementAt: null })).status).toBe(
      200,
    );
    expect((await listed(pub)).page.items).toHaveLength(0);
    const { rows } = await t.db.execute<{ action: string; fields: string }>(
      sql`select action, details->>'fields' as fields from admin_audit_log where target = ${`shop:${shop.id}`}
        and details->>'status' = '200' order by created_at`,
    );
    expect(rows).toEqual([
      { action: "shop.update", fields: "listingAgreementAt" },
      { action: "shop.update", fields: "listingAgreementAt" },
    ]);
    const { rows: days } = await t.db.execute<{ day: string | null }>(
      sql`select details->>'listingAgreementAt' as day from admin_audit_log where target = ${`shop:${shop.id}`}
        and details->>'status' = '200' order by created_at, id`,
    );
    expect(days.map((d) => d.day).sort()).toEqual(["2026-11-10", null].sort());
  });
});
