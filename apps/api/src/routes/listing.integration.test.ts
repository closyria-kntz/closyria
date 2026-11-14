import { createHash } from "node:crypto";
import { eq, schema, sql } from "@closyria/db";
import {
  adminInvitationCreatedSchema,
  adminListingRequestAcceptedSchema,
  adminListingRequestListSchema,
  adminShopAgreementsSchema,
  catalogPageSchema,
  LISTING_CONDITIONS,
  listingAcceptedSchema,
  listingInvitationViewSchema,
  listingManageViewSchema,
  shopDirectorySchema,
} from "@closyria/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../catalog/test-app";

// Accords de référencement en ligne (docs/specs/2026-11-14-catalogue-conforme.md §6): the invitation link's life
// (hash only, 60 days, one open per shop, accepted once, revocable), the partner status and the catalogue that
// follow the agreement, the withdrawal, the public request and its admin decision, the admin's checkbox, the limits,
// and « {n} articles chez elle » on the tiles.

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
type Person = { cookie: string; userId: string };
let t: Harness;
let pub: Person;
let admin: Person;
let counter = 0;
let ip = 0;
const START = new Date("2026-11-14T12:00:00Z");
let clock = START;
const DAY = 24 * 60 * 60 * 1000;
const consent = { authorized: true, accepted: true, conditionsVersion: LISTING_CONDITIONS.version };

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness({ now: () => clock });
  pub = await t.signIn();
  admin = await t.signIn();
  await t.db
    .update(schema.user)
    .set({ role: "admin", isAnonymous: false, name: "Fondatrice", email: "fondatrice@closyria.test" })
    .where(eq(schema.user.id, admin.userId));
  await t.db.update(schema.session).set({ authMethod: "passkey" }).where(eq(schema.session.userId, admin.userId));
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

beforeEach(async () => {
  clock = START;
  await t.db.delete(schema.listingRequests);
  await t.db.delete(schema.shopInvitations);
  await t.db.delete(schema.shopAgreements);
  await t.db.delete(schema.captures);
  await t.db.delete(schema.products);
  await t.db.delete(schema.shopDomains);
  await t.db.delete(schema.shops);
  await t.db.delete(schema.adminAuditLog);
});

/** Each call comes from its own address unless one is given: the limits are per address. */
function call(method: string, path: string, cookie: string, body?: unknown, from = `10.77.${++ip >> 8}.${ip % 250}`) {
  return t.app.request(`/api${path}`, {
    method,
    headers: {
      origin: BASE_URL,
      "x-forwarded-for": from,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function newShop(name = `Atelier ${++counter}`) {
  const n = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name, slug: `accord-${n}`, status: "published" })
    .returning();
  if (!shop) throw new Error("no shop");
  await t.db.insert(schema.shopDomains).values({ shopId: shop.id, domain: `accord-${n}.test` });
  return { ...shop, domain: `accord-${n}.test` };
}

/** A complete article with a photo that only an import brought (never pasted): public only for a partner shop. */
async function importedProduct(shopId: string) {
  const n = ++counter;
  const [p] = await t.db
    .insert(schema.products)
    .values({
      shopId,
      canonicalUrl: `https://accord.test/${n}`,
      name: `Robe importée ${n}`,
      priceCents: 5000,
      currency: "EUR",
      publishedAt: START,
      publishedSource: "shop",
      lastCapturedAt: START,
    })
    .returning();
  if (!p) throw new Error("no product");
  await t.db
    .insert(schema.productImages)
    .values({ productId: p.id, position: 0, key: `products/${p.id}/0.webp`, width: 6, height: 8, sourceHash: `h${n}` });
  return p;
}

async function invite(shopId: string) {
  const res = await call("POST", `/admin/shops/${shopId}/invitations`, admin.cookie);
  expect(res.status).toBe(201);
  return adminInvitationCreatedSchema.parse(await res.json());
}

const accept = (token: string, body: unknown = { name: "Léa Martin", email: "Lea@Atelier.test", ...consent }) =>
  call("POST", `/listing/invitations/${token}/accept`, "", body);

const isPartner = async (shopId: string) =>
  (await t.db.select().from(schema.shops).where(eq(schema.shops.id, shopId)))[0]?.listingAgreementAt ?? null;

const publicIds = async () =>
  catalogPageSchema.parse(await (await call("GET", "/catalog", pub.cookie)).json()).items.map((i) => i.productId);

describe("invitation link", () => {
  it("stores only the token's SHA-256, lives 60 days and shows the shop", async () => {
    const shop = await newShop("Atelier Lune");
    const { token, expiresAt } = await invite(shop.id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Date(expiresAt).getTime()).toBe(START.getTime() + 60 * DAY);
    const rows = await t.db.select().from(schema.shopInvitations);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(rows)).not.toContain(token);
    // Nor in the journal.
    const audit = await t.db.select().from(schema.adminAuditLog);
    expect(audit.map((a) => a.action)).toEqual(["shop.invitation.create"]);
    expect(JSON.stringify(audit)).not.toContain(token);

    const res = await call("GET", `/listing/invitations/${token}`, "");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(listingInvitationViewSchema.parse(await res.json())).toEqual({
      shop: { name: "Atelier Lune", domain: shop.domain },
      conditions: { version: LISTING_CONDITIONS.version, sha256: LISTING_CONDITIONS.sha256 },
    });
  });

  it("is accepted once: the agreement is recorded, the shop becomes a partner, the link is used", async () => {
    const shop = await newShop();
    const { token } = await invite(shop.id);
    clock = new Date(START.getTime() + 3 * DAY);
    const res = await accept(token);
    expect(res.status).toBe(201);
    const { shopName, manageToken } = listingAcceptedSchema.parse(await res.json());
    expect(shopName).toBe(shop.name);
    expect((await isPartner(shop.id))?.toISOString()).toBe(clock.toISOString());

    const [agreement] = await t.db.select().from(schema.shopAgreements);
    expect(agreement).toMatchObject({
      shopId: shop.id,
      via: "invitation",
      signerName: "Léa Martin",
      signerEmail: "lea@atelier.test",
      conditionsVersion: LISTING_CONDITIONS.version,
      conditionsSha256: LISTING_CONDITIONS.sha256,
      withdrawnAt: null,
      manageTokenHash: createHash("sha256").update(manageToken).digest("hex"),
    });
    expect(agreement?.acceptedAt.toISOString()).toBe(clock.toISOString());
    // No IP address anywhere in what was kept.
    expect(JSON.stringify(agreement)).not.toMatch(/10\.77\./);
    const [invitation] = await t.db.select().from(schema.shopInvitations);
    expect(invitation?.acceptedAt?.toISOString()).toBe(clock.toISOString());
    expect(invitation?.agreementId).toBe(agreement?.id);
    // The trace in the journal: no admin, no personal data.
    const traces = await t.db
      .select()
      .from(schema.adminAuditLog)
      .where(eq(schema.adminAuditLog.action, "shop.agreement.accept"));
    expect(traces).toHaveLength(1);
    expect(traces[0]?.adminId).toBeNull();
    expect(traces[0]?.target).toBe(`shop:${shop.id}`);
    expect(JSON.stringify(traces[0])).not.toMatch(/Léa|lea@/i);

    // Once only.
    expect((await accept(token)).status).toBe(404);
    expect((await call("GET", `/listing/invitations/${token}`, "")).status).toBe(404);
    expect(await t.db.select().from(schema.shopAgreements)).toHaveLength(1);
  });

  it("two acceptances at the same time record one agreement", async () => {
    const shop = await newShop();
    const { token } = await invite(shop.id);
    const statuses = (await Promise.all([accept(token), accept(token), accept(token)])).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 404, 404]);
    expect(await t.db.select().from(schema.shopAgreements)).toHaveLength(1);
  });

  it("refuses unticked boxes, older conditions and a missing name", async () => {
    const shop = await newShop();
    const { token } = await invite(shop.id);
    const ok = { name: "Léa", email: "lea@a.test", ...consent };
    for (const body of [
      { ...ok, authorized: false },
      { ...ok, accepted: false },
      { ...ok, conditionsVersion: "v0" },
      { ...ok, name: "" },
      { ...ok, email: "pas-un-mail" },
    ]) {
      expect((await accept(token, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await isPartner(shop.id)).toBeNull();
    expect((await call("GET", `/listing/invitations/${token}`, "")).status).toBe(200);
  });

  it("expires after 60 days", async () => {
    const shop = await newShop();
    const { token } = await invite(shop.id);
    clock = new Date(START.getTime() + 60 * DAY - 1000);
    expect((await call("GET", `/listing/invitations/${token}`, "")).status).toBe(200);
    clock = new Date(START.getTime() + 60 * DAY);
    expect((await call("GET", `/listing/invitations/${token}`, "")).status).toBe(404);
    expect((await accept(token)).status).toBe(404);
    expect(await isPartner(shop.id)).toBeNull();
  });

  it("is revoked by « Révoquer » and by a newer link (one open per shop)", async () => {
    const shop = await newShop();
    const first = await invite(shop.id);
    const second = await invite(shop.id);
    expect((await call("GET", `/listing/invitations/${first.token}`, "")).status).toBe(404);
    expect((await call("GET", `/listing/invitations/${second.token}`, "")).status).toBe(200);
    const view = adminShopAgreementsSchema.parse(
      await (await call("GET", `/admin/shops/${shop.id}/agreements`, admin.cookie)).json(),
    );
    expect(view.invitation?.expiresAt).toBe(second.expiresAt);
    expect((await call("DELETE", `/admin/shops/${shop.id}/invitations`, admin.cookie)).status).toBe(204);
    expect((await call("GET", `/listing/invitations/${second.token}`, "")).status).toBe(404);
    expect((await accept(second.token)).status).toBe(404);
    const after = adminShopAgreementsSchema.parse(
      await (await call("GET", `/admin/shops/${shop.id}/agreements`, admin.cookie)).json(),
    );
    expect(after.invitation).toBeNull();
  });

  it("answers a bad link with the same 404 and nothing about the shop", async () => {
    const shop = await newShop("Maison Secrète");
    const used = await invite(shop.id);
    expect((await accept(used.token)).status).toBe(201);
    const revoked = await invite(shop.id);
    await call("DELETE", `/admin/shops/${shop.id}/invitations`, admin.cookie);
    const expired = await invite(shop.id);
    clock = new Date(START.getTime() + 61 * DAY);
    const bodies = new Set<string>();
    for (const token of [used.token, revoked.token, expired.token, "A".repeat(43), "court", "x".repeat(200)]) {
      const res = await call("GET", `/listing/invitations/${token}`, "");
      expect(res.status, token).toBe(404);
      const text = await res.text();
      expect(text).not.toContain("Secrète");
      expect(text).not.toContain(shop.id);
      bodies.add(text);
    }
    expect([...bodies]).toEqual([JSON.stringify({ error: "invalid_link" })]);
  });

  it("is an admin's action only", async () => {
    const shop = await newShop();
    expect((await call("POST", `/admin/shops/${shop.id}/invitations`, pub.cookie)).status).toBe(403);
    expect((await call("GET", `/admin/shops/${shop.id}/agreements`, pub.cookie)).status).toBe(403);
    expect((await call("GET", "/admin/listing-requests", pub.cookie)).status).toBe(403);
    expect((await call("POST", `/admin/shops/${crypto.randomUUID()}/invitations`, admin.cookie)).status).toBe(404);
  });
});

describe("partner status and catalogue", () => {
  it("an imported-only article becomes public with the agreement and private again after withdrawal", async () => {
    const shop = await newShop();
    const product = await importedProduct(shop.id);
    expect(await publicIds()).not.toContain(product.id);

    const { token } = await invite(shop.id);
    const { manageToken } = listingAcceptedSchema.parse(await (await accept(token)).json());
    expect(await publicIds()).toContain(product.id);

    const view = await call("GET", `/listing/manage/${manageToken}`, "");
    expect(listingManageViewSchema.parse(await view.json())).toMatchObject({ shopName: shop.name, withdrawnAt: null });

    clock = new Date(START.getTime() + DAY);
    const res = await call("POST", `/listing/manage/${manageToken}/withdraw`, "");
    expect(res.status).toBe(200);
    expect(listingManageViewSchema.parse(await res.json()).withdrawnAt).toBe(clock.toISOString());
    expect(await isPartner(shop.id)).toBeNull();
    expect(await publicIds()).not.toContain(product.id);
    const [agreement] = await t.db.select().from(schema.shopAgreements);
    expect(agreement).toMatchObject({ withdrawnBy: "signer" });
    expect(agreement?.withdrawnAt?.toISOString()).toBe(clock.toISOString());

    // Again: the same answer, nothing changes.
    const again = await call("POST", `/listing/manage/${manageToken}/withdraw`, "");
    expect(listingManageViewSchema.parse(await again.json()).withdrawnAt).toBe(clock.toISOString());
    const traces = await t.db
      .select()
      .from(schema.adminAuditLog)
      .where(eq(schema.adminAuditLog.action, "shop.agreement.withdraw"));
    expect(traces).toHaveLength(1);
    expect(traces[0]?.adminId).toBeNull();

    // A bad management link.
    expect((await call("GET", `/listing/manage/${"B".repeat(43)}`, "")).status).toBe(404);
    expect((await call("POST", `/listing/manage/${"B".repeat(43)}/withdraw`, "")).status).toBe(404);
  });

  it("a newer agreement replaces the one in force (one per shop)", async () => {
    const shop = await newShop();
    await accept((await invite(shop.id)).token);
    const second = listingAcceptedSchema.parse(await (await accept((await invite(shop.id)).token)).json());
    const rows = await t.db.select().from(schema.shopAgreements).orderBy(schema.shopAgreements.createdAt);
    expect(rows.map((r) => r.withdrawnBy)).toEqual(["replaced", null]);
    expect(await isPartner(shop.id)).not.toBeNull();
    await call("POST", `/listing/manage/${second.manageToken}/withdraw`, "");
    expect(await isPartner(shop.id)).toBeNull();
  });

  it("the admin's checkbox records an agreement she signs, and unticking it ends the one in force", async () => {
    const shop = await newShop();
    expect(
      (await call("PATCH", `/admin/shops/${shop.id}`, admin.cookie, { listingAgreementAt: "2026-11-10" })).status,
    ).toBe(200);
    let view = adminShopAgreementsSchema.parse(
      await (await call("GET", `/admin/shops/${shop.id}/agreements`, admin.cookie)).json(),
    );
    expect(view.agreements).toEqual([
      expect.objectContaining({
        via: "admin",
        signerName: "Fondatrice",
        signerEmail: "fondatrice@closyria.test",
        acceptedAt: "2026-11-10T00:00:00.000Z",
        withdrawnAt: null,
      }),
    ]);
    // Moving the day moves her agreement; the same day changes nothing.
    await call("PATCH", `/admin/shops/${shop.id}`, admin.cookie, { listingAgreementAt: "2026-11-11" });
    await call("PATCH", `/admin/shops/${shop.id}`, admin.cookie, { listingAgreementAt: "2026-11-11" });
    view = adminShopAgreementsSchema.parse(
      await (await call("GET", `/admin/shops/${shop.id}/agreements`, admin.cookie)).json(),
    );
    expect(view.agreements.map((a) => a.acceptedAt)).toEqual(["2026-11-11T00:00:00.000Z"]);

    await call("PATCH", `/admin/shops/${shop.id}`, admin.cookie, { listingAgreementAt: null });
    expect(await isPartner(shop.id)).toBeNull();
    view = adminShopAgreementsSchema.parse(
      await (await call("GET", `/admin/shops/${shop.id}/agreements`, admin.cookie)).json(),
    );
    expect(view.agreements[0]).toMatchObject({ withdrawnBy: "admin", withdrawnAt: START.toISOString() });
  });

  it("saving the settings keeps the exact time of a signed agreement", async () => {
    const shop = await newShop();
    clock = new Date("2026-11-14T15:42:00Z");
    await accept((await invite(shop.id)).token);
    await call("PATCH", `/admin/shops/${shop.id}`, admin.cookie, {
      listingAgreementAt: "2026-11-14",
      name: "Renommée",
    });
    expect((await isPartner(shop.id))?.toISOString()).toBe("2026-11-14T15:42:00.000Z");
    const rows = await t.db.select().from(schema.shopAgreements);
    expect(rows.map((r) => [r.via, r.withdrawnAt])).toEqual([["invitation", null]]);
  });
});

describe("« Référencer ma boutique »", () => {
  const request = {
    shopName: "Atelier Soleil",
    siteUrl: "atelier-soleil.test",
    name: "Inès Roy",
    email: "ines@atelier-soleil.test",
    message: "Bonjour !",
    ...consent,
  };

  it("records a pending request the admin sees, with the shop of its site", async () => {
    const shop = await newShop("Soleil (déjà connue)");
    await t.db.insert(schema.shopDomains).values({ shopId: shop.id, domain: "atelier-soleil.test" });
    const res = await call("POST", "/listing/requests", "", request);
    expect(res.status).toBe(202);
    const list = adminListingRequestListSchema.parse(
      await (await call("GET", "/admin/listing-requests?status=pending", admin.cookie)).json(),
    );
    expect(list.requests).toEqual([
      expect.objectContaining({
        status: "pending",
        shopName: "Atelier Soleil",
        siteUrl: "https://atelier-soleil.test",
        signerName: "Inès Roy",
        signerEmail: "ines@atelier-soleil.test",
        message: "Bonjour !",
        shop: { id: shop.id, name: "Soleil (déjà connue)" },
      }),
    ]);
  });

  it("drops a filled honeypot silently and refuses invalid fields", async () => {
    expect((await call("POST", "/listing/requests", "", { ...request, website: "spam.test" })).status).toBe(202);
    expect(await t.db.select().from(schema.listingRequests)).toHaveLength(0);
    for (const body of [
      { ...request, siteUrl: "javascript:alert(1)" },
      { ...request, authorized: false },
      { ...request, email: "x" },
      { ...request, shopName: "" },
      { ...request, message: "x".repeat(2001) },
    ]) {
      expect((await call("POST", "/listing/requests", "", body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await t.db.select().from(schema.listingRequests)).toHaveLength(0);
  });

  it("is limited to 5 an hour per address", async () => {
    const from = "10.88.0.1";
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await call("POST", "/listing/requests", "", request, from)).status);
    expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
    // Another address is not held back.
    expect((await call("POST", "/listing/requests", "", request, "10.88.0.2")).status).toBe(202);
  });

  it("accepted after the admin's check: the shop is created as a draft and becomes a partner (via request)", async () => {
    await call("POST", "/listing/requests", "", request);
    const [pending] = await t.db.select().from(schema.listingRequests);
    if (!pending) throw new Error("no request");
    expect((await call("POST", `/admin/listing-requests/${pending.id}/accept`, admin.cookie, {})).status).toBe(400);
    const res = await call("POST", `/admin/listing-requests/${pending.id}/accept`, admin.cookie, { verified: true });
    expect(res.status).toBe(200);
    const { shopId, manageToken } = adminListingRequestAcceptedSchema.parse(await res.json());
    const [shop] = await t.db.select().from(schema.shops).where(eq(schema.shops.id, shopId));
    expect(shop).toMatchObject({ name: "Atelier Soleil", status: "draft" });
    expect(shop?.listingAgreementAt?.toISOString()).toBe(START.toISOString());
    const [agreement] = await t.db.select().from(schema.shopAgreements);
    expect(agreement).toMatchObject({
      via: "request",
      signerName: "Inès Roy",
      signerEmail: "ines@atelier-soleil.test",
      adminId: admin.userId,
      conditionsVersion: LISTING_CONDITIONS.version,
    });
    const [decided] = await t.db.select().from(schema.listingRequests);
    expect(decided).toMatchObject({ status: "accepted", shopId, agreementId: agreement?.id });
    // Decided once.
    expect(
      (await call("POST", `/admin/listing-requests/${pending.id}/accept`, admin.cookie, { verified: true })).status,
    ).toBe(409);
    // The signer can withdraw with the link the admin sends her.
    await call("POST", `/listing/manage/${manageToken}/withdraw`, "");
    expect(await isPartner(shopId)).toBeNull();
    const audit = await t.db.execute<{ action: string }>(
      sql`select action from admin_audit_log where target = ${`listing_request:${pending.id}`} order by created_at`,
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["listing_request.accept", "listing_request.accept"]);
  });

  it("refused: nothing personal is kept", async () => {
    await call("POST", "/listing/requests", "", request);
    const [pending] = await t.db.select().from(schema.listingRequests);
    if (!pending) throw new Error("no request");
    expect((await call("POST", `/admin/listing-requests/${pending.id}/refuse`, admin.cookie)).status).toBe(204);
    const [refused] = await t.db.select().from(schema.listingRequests);
    expect(refused).toMatchObject({ status: "refused", signerName: null, signerEmail: null, message: null });
    expect((await call("POST", `/admin/listing-requests/${pending.id}/refuse`, admin.cookie)).status).toBe(409);
    expect(
      (await call("POST", `/admin/listing-requests/${pending.id}/accept`, admin.cookie, { verified: true })).status,
    ).toBe(409);
    expect(await t.db.select().from(schema.shopAgreements)).toHaveLength(0);
  });
});

describe("shop tiles", () => {
  it("a shop without agreement tells how many articles Closyria knows of it, imports included; a partner nothing", async () => {
    const plain = await newShop("Sans accord");
    const partner = await newShop("Partenaire");
    await importedProduct(plain.id);
    await importedProduct(plain.id);
    await importedProduct(partner.id);
    await accept((await invite(partner.id)).token);
    const directory = shopDirectorySchema.parse(await (await call("GET", "/shops", pub.cookie)).json());
    const tile = (id: string) => directory.shops.find((s) => s.id === id);
    expect(tile(plain.id)).toMatchObject({ itemCount: 0, knownCount: 2, imageUrl: null });
    expect(tile(partner.id)).toMatchObject({ itemCount: 1, knownCount: null });
  });
});
