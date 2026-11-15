import { eq, schema } from "@closyria/db";
import {
  AI_MONTHLY_CAP_SETTING,
  adminOrderEmailsSchema,
  adminOverviewSchema,
  adminShopDetailSchema,
} from "@closyria/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";

// « Après la commande » Task 8 (spec §4): the shop's return settings, « E-mails de commande », the AI cap and the
// dashboard's parcel tiles. Aggregates only: never an e-mail's sender, content or lines.

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let adminCookie: string;
let userCookie: string;
let owner: { userId: string; profileId: string; inboxId: string };
let counter = 0;
const NOW = new Date("2026-11-20T12:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness({ now: () => NOW });
  const admin = await t.signIn();
  await t.db.update(schema.user).set({ role: "admin", isAnonymous: false }).where(eq(schema.user.id, admin.userId));
  await t.db.update(schema.session).set({ authMethod: "passkey" }).where(eq(schema.session.userId, admin.userId));
  adminCookie = admin.cookie;
  const user = await t.signIn();
  userCookie = user.cookie;
  await t.db.update(schema.user).set({ isAnonymous: false }).where(eq(schema.user.id, user.userId));
  // « Moi », created on the first read.
  const profiles = await t.app.request("/api/me/profiles", { headers: { origin: BASE_URL, cookie: user.cookie } });
  const profile = ((await profiles.json()) as { profiles: { id: string }[] }).profiles[0];
  const [inbox] = await t.db
    .insert(schema.orderInboxes)
    .values({ userId: user.userId, localPart: "marie-ab12" })
    .returning();
  if (!profile || !inbox) throw new Error("fixtures");
  owner = { userId: user.userId, profileId: profile.id, inboxId: inbox.id };
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

beforeEach(async () => {
  await t.db.delete(schema.orders);
  await t.db.delete(schema.inboundEmails);
  await t.db.delete(schema.aiUsageMonths);
  await t.db.delete(schema.appSettings);
  await t.db.delete(schema.adminAuditLog);
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

async function newShop(name = `Boutique ${++counter}`) {
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name, slug: `adm-orders-${++counter}` })
    .returning();
  if (!shop) throw new Error("no shop");
  await t.db.insert(schema.shopDomains).values({ domain: `adm-orders-${counter}.test`, shopId: shop.id });
  return shop;
}

async function email(status: "ignored" | "queued" | "parsed" | "failed", receivedAt = ago(1)) {
  const [row] = await t.db
    .insert(schema.inboundEmails)
    .values({
      userId: status === "ignored" ? null : owner.userId,
      inboxId: owner.inboxId,
      receivedAt,
      queueId: `Q${++counter}`,
      fromAddress: status === "ignored" ? "stranger@spam.test" : "marie.secret@perso.test",
      authOk: status !== "ignored",
      status,
      purgeAfter: new Date(receivedAt.getTime() + 30 * DAY),
    })
    .returning();
  if (!row) throw new Error("no e-mail");
  return row;
}

async function order(values: Partial<typeof schema.orders.$inferInsert> = {}) {
  const [row] = await t.db
    .insert(schema.orders)
    .values({
      userId: owner.userId,
      profileId: owner.profileId,
      status: "confirmed",
      source: "email",
      parseMethod: "known",
      ...values,
    })
    .returning();
  if (!row) throw new Error("no order");
  await t.db.insert(schema.orderLines).values({ orderId: row.id, name: "Robe Secrète Lila", quantity: 1 });
  return row;
}

async function parcel(orderId: string, values: Partial<typeof schema.parcels.$inferInsert> = {}) {
  await t.db.insert(schema.parcels).values({
    orderId,
    trackingNumber: `6A${String(++counter).padStart(11, "0")}`,
    checkUntil: new Date(NOW.getTime() + 20 * DAY),
    ...values,
  });
}

describe("access", () => {
  it("refuses a non-admin (403) and a visitor (401) on the new routes", async () => {
    const routes: [string, string, unknown?][] = [
      ["GET", "/order-emails"],
      ["PUT", "/settings/ai-cap", { capCents: 500 }],
    ];
    for (const [method, path, body] of routes) {
      expect((await call(method, path, body, userCookie)).status, `${method} ${path}`).toBe(403);
      expect((await call(method, path, body, "")).status, `${method} ${path}`).toBe(401);
    }
    const [row] = await t.db.select().from(schema.appSettings);
    expect(row).toBeUndefined();
  });
});

describe("shop returns (délai de retour, page des retours)", () => {
  it("reads 14 days and no page by default, then saves both and journals them", async () => {
    const shop = await newShop();
    const before = adminShopDetailSchema.parse(await (await call("GET", `/shops/${shop.id}`)).json());
    expect(before).toMatchObject({ returnDays: 14, returnsUrl: null, carriersSeen: [] });

    const res = await call("PATCH", `/shops/${shop.id}`, { returnDays: 30, returnsUrl: "https://lila.test/retours" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ returnDays: 30, returnsUrl: "https://lila.test/retours" });
    const [row] = await t.db.select().from(schema.shops).where(eq(schema.shops.id, shop.id));
    expect(row).toMatchObject({ returnDays: 30, returnsUrl: "https://lila.test/retours" });
    const [audit] = await t.db.select().from(schema.adminAuditLog);
    expect(audit).toMatchObject({ action: "shop.update", details: { fields: "returnDays,returnsUrl" } });

    expect((await call("PATCH", `/shops/${shop.id}`, { returnsUrl: null })).status).toBe(200);
    const [cleared] = await t.db.select().from(schema.shops).where(eq(schema.shops.id, shop.id));
    expect(cleared?.returnsUrl).toBeNull();
  });

  it("refuses a delay outside 0–365 or a page that is not https, and changes nothing", async () => {
    const shop = await newShop();
    for (const body of [
      { returnDays: 366 },
      { returnDays: -1 },
      { returnDays: 7.5 },
      { returnsUrl: "http://lila.test/retours" },
      { returnsUrl: "javascript:alert(1)" },
    ]) {
      expect((await call("PATCH", `/shops/${shop.id}`, body)).status, JSON.stringify(body)).toBe(400);
    }
    const [row] = await t.db.select().from(schema.shops).where(eq(schema.shops.id, shop.id));
    expect(row).toMatchObject({ returnDays: 14, returnsUrl: null });
  });

  it("lists the carriers seen on its orders' parcels, once each, alphabetical", async () => {
    const shop = await newShop();
    const other = await newShop();
    const a = await order({ shopId: shop.id });
    const b = await order({ shopId: shop.id });
    await parcel(a.id, { carrier: "mondial_relay" });
    await parcel(a.id, { carrier: "colissimo" });
    await parcel(b.id, { carrier: "colissimo" });
    await parcel(b.id, { carrier: null });
    await parcel((await order({ shopId: other.id })).id, { carrier: "dhl" });
    const detail = adminShopDetailSchema.parse(await (await call("GET", `/shops/${shop.id}`)).json());
    expect(detail.carriersSeen).toEqual(["colissimo", "mondial_relay"]);
  });
});

describe("GET /api/admin/order-emails", () => {
  it("counts the window's e-mails by status and method, and reads per shop", async () => {
    const lila = await newShop("Maison Lila");
    const nour = await newShop("Nour");
    // Lila: two read (one by the AI), one failed she typed by hand, one read she dismissed.
    for (const method of ["known", "ai"] as const) {
      await order({ shopId: lila.id, inboundEmailId: (await email("parsed")).id, parseMethod: method });
    }
    await order({
      shopId: lila.id,
      inboundEmailId: (await email("failed")).id,
      source: "manual",
      parseMethod: "manual",
    });
    await order({ shopId: lila.id, inboundEmailId: (await email("parsed")).id, status: "dismissed" });
    // Nour: one read.
    await order({ shopId: nour.id, inboundEmailId: (await email("parsed")).id });
    // No shop: one failed, never typed; one read without a shop.
    await email("failed");
    await order({ inboundEmailId: (await email("parsed")).id });
    await email("ignored");
    await email("ignored");
    await email("queued");
    // Older than the window: not counted.
    await email("parsed", ago(40));

    const res = await call("GET", "/order-emails");
    expect(res.status).toBe(200);
    const body = adminOrderEmailsSchema.parse(await res.json());
    expect(body.days).toBe(30);
    expect(body.counts).toEqual({ received: 10, ignored: 2, queued: 1, parsed: 5, failed: 2 });
    expect(body.byMethod).toEqual({ known: 4, ai: 1 });
    expect(body.shops).toEqual([
      { shopId: lila.id, name: "Maison Lila", parsed: 3, failed: 1, dismissed: 1, readRate: 0.75 },
      { shopId: null, name: null, parsed: 1, failed: 1, dismissed: 0, readRate: 0.5 },
      { shopId: nour.id, name: "Nour", parsed: 1, failed: 0, dismissed: 0, readRate: 1 },
    ]);
  });

  it("never answers a sender, an address, a line or a user", async () => {
    const shop = await newShop();
    await order({ shopId: shop.id, inboundEmailId: (await email("parsed")).id });
    await email("ignored");
    const text = await (await call("GET", "/order-emails")).text();
    for (const secret of ["marie.secret", "perso.test", "stranger", "spam.test", "Robe Secrète", "marie-ab12"]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain(owner.userId);
  });

  it("gives the month's AI cost against the cap (10 € by default)", async () => {
    await t.db.insert(schema.aiUsageMonths).values([
      { month: "2026-11", costNanoUsd: 25_000_000, calls: 7 },
      { month: "2026-10", costNanoUsd: 900_000_000, calls: 99 },
    ]);
    const body = adminOrderEmailsSchema.parse(await (await call("GET", "/order-emails")).json());
    expect(body.ai).toEqual({ month: "2026-11", costCents: 2.5, calls: 7, capCents: 1000 });
  });
});

describe("PUT /api/admin/settings/ai-cap", () => {
  it("saves the cap, read back by the page and journalled", async () => {
    const res = await call("PUT", "/settings/ai-cap", { capCents: 2500 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ capCents: 2500 });
    const [row] = await t.db
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, AI_MONTHLY_CAP_SETTING));
    expect(row?.value).toBe(2500);
    const body = adminOrderEmailsSchema.parse(await (await call("GET", "/order-emails")).json());
    expect(body.ai.capCents).toBe(2500);
    const [audit] = await t.db.select().from(schema.adminAuditLog);
    expect(audit).toMatchObject({ action: "settings.ai_cap", details: { capCents: 2500 } });
    // Saved again: replaced, not duplicated.
    expect((await call("PUT", "/settings/ai-cap", { capCents: 0 })).status).toBe(200);
    expect(await t.db.select().from(schema.appSettings)).toHaveLength(1);
  });

  it("refuses a cap above 1 000 €, negative or not whole", async () => {
    for (const capCents of [100_001, -1, 9.5]) {
      expect((await call("PUT", "/settings/ai-cap", { capCents })).status, String(capCents)).toBe(400);
    }
    expect(await t.db.select().from(schema.appSettings)).toHaveLength(0);
  });
});

describe("GET /api/admin/overview (colis)", () => {
  it("counts parcels tracked, delivered over 30 days, and in trouble over 30 days", async () => {
    const shop = await newShop();
    const confirmed = await order({ shopId: shop.id });
    const draft = await order({ shopId: shop.id, status: "draft" });
    // Tracked: a next check planned, validated orders only.
    await parcel(confirmed.id, { status: "in_transit", nextCheckAt: new Date(NOW.getTime() + DAY) });
    await parcel(confirmed.id, { status: "pending", nextCheckAt: ago(0.01) });
    await parcel(draft.id, { status: "pending", nextCheckAt: new Date(NOW.getTime() + DAY) });
    // Delivered: within 30 days, and an older one.
    await parcel(confirmed.id, { status: "delivered", deliveredAt: ago(3) });
    await parcel(confirmed.id, { status: "delivered", deliveredAt: ago(45) });
    // In trouble: exception or unknown, created within 30 days (an older one is not counted).
    await parcel(confirmed.id, { status: "exception", nextCheckAt: new Date(NOW.getTime() + DAY) });
    await parcel(confirmed.id, { status: "unknown" });
    await parcel(confirmed.id, { status: "unknown", createdAt: ago(40) });

    const body = adminOverviewSchema.parse(await (await call("GET", "/overview")).json());
    expect(body.parcels).toEqual({ tracked: 3, delivered30d: 1, failing30d: 2 });
  });
});
