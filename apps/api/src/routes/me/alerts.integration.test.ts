import { eq, schema } from "@closyria/db";
import type {
  AlertPage,
  AlertSettings,
  HomeView,
  ItemMutationResult,
  ItemView,
  PushSubscriptionList,
  PushSubscriptionView,
} from "@closyria/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let off: Harness;
let counter = 0;
const PUBLIC_KEY = `B${"A".repeat(86)}`;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  [t, off] = await Promise.all([createCatalogHarness({}, { pushPublicKey: PUBLIC_KEY }), createCatalogHarness()]);
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await Promise.all([t?.stop(), off?.stop()]);
});

function call(method: string, path: string, cookie: string | undefined, body?: unknown, h: Harness = t) {
  return h.app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      origin: BASE_URL,
      "content-type": "application/json",
      "user-agent": "Firefox test",
      ...(cookie ? { cookie } : {}),
    },
  });
}

/** A signed-in person with a real account (not a guest). */
async function account() {
  const session = await t.signIn();
  await t.db.update(schema.user).set({ isAnonymous: false }).where(eq(schema.user.id, session.userId));
  return session;
}

async function shop(values: Partial<typeof schema.shops.$inferInsert> = {}) {
  const n = ++counter;
  const [row] = await t.db
    .insert(schema.shops)
    .values({ name: `Boutique A${n}`, slug: `me-alerts-shop-${n}`, ...values })
    .returning();
  if (!row) throw new Error("no shop");
  return row;
}

/** A wish of hers on a new product of `shopId` (a new shop by default). */
async function wish(cookie: string, shopId?: string): Promise<ItemView> {
  const n = ++counter;
  const [product] = await t.db
    .insert(schema.products)
    .values({
      shopId: shopId ?? (await shop()).id,
      canonicalUrl: `https://me-alerts-${n}.test/p`,
      name: `Robe ${n}`,
      priceCents: 8000,
      currency: "EUR",
    })
    .returning();
  if (!product) throw new Error("no product");
  const res = await call("POST", "/api/me/items", cookie, { productId: product.id, action: "wish" });
  expect(res.status).toBe(201);
  return ((await res.json()) as ItemMutationResult).item;
}

async function event(values: typeof schema.alertEvents.$inferInsert) {
  const [row] = await t.db.insert(schema.alertEvents).values(values).returning();
  if (!row) throw new Error("no event");
  return row;
}

const itemEvent = (item: ItemView, userId: string, extra: Partial<typeof schema.alertEvents.$inferInsert> = {}) =>
  event({
    userId,
    itemId: item.id,
    profileId: item.profileId,
    productId: item.product.id,
    kind: "size_back",
    sizeLabel: "M",
    ...extra,
  });

async function page(cookie: string, cursor?: string): Promise<AlertPage> {
  const res = await call("GET", `/api/me/alerts${cursor ? `?cursor=${cursor}` : ""}`, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as AlertPage;
}

const subscription = (endpoint: string, p256dh = "key-1") => ({ endpoint, keys: { p256dh, auth: "auth-1" } });

describe("GET /api/push/key", () => {
  it("gives the VAPID public key when push is on", async () => {
    const res = await call("GET", "/api/push/key", undefined);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ publicKey: PUBLIC_KEY });
  });

  it("answers 404 when push is off", async () => {
    const res = await call("GET", "/api/push/key", undefined, undefined, off);
    expect(res.status).toBe(404);
  });
});

describe("/api/me/push-subscriptions", () => {
  it("answers 401 without a session", async () => {
    expect((await call("GET", "/api/me/push-subscriptions", undefined)).status).toBe(401);
    expect((await call("POST", "/api/me/push-subscriptions", undefined, subscription("https://p.test/x"))).status).toBe(
      401,
    );
  });

  it("refuses a guest: create an account first", async () => {
    const guest = await t.signIn();
    const res = await call("POST", "/api/me/push-subscriptions", guest.cookie, subscription("https://p.test/guest"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "account_required" });
    const rows = await t.db
      .select()
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, guest.userId));
    expect(rows).toEqual([]);
  });

  it("keeps one row per endpoint: subscribing again updates it", async () => {
    const a = await account();
    const endpoint = `https://push.test/${++counter}`;
    const first = await call("POST", "/api/me/push-subscriptions", a.cookie, subscription(endpoint, "old"));
    expect(first.status).toBe(200);
    const view = (await first.json()) as PushSubscriptionView;
    expect(view.userAgent).toBe("Firefox test");
    const again = await call("POST", "/api/me/push-subscriptions", a.cookie, subscription(endpoint, "new"));
    expect(((await again.json()) as PushSubscriptionView).id).toBe(view.id);
    const rows = await t.db
      .select()
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.endpoint, endpoint));
    expect(rows.map((r) => [r.userId, r.p256dh])).toEqual([[a.userId, "new"]]);
    const list = (await (await call("GET", "/api/me/push-subscriptions", a.cookie)).json()) as PushSubscriptionList;
    expect(list.subscriptions.map((s) => s.id)).toEqual([view.id]);
  });

  it("moves a browser subscribed under another account to hers", async () => {
    const a = await account();
    const b = await account();
    const endpoint = `https://push.test/${++counter}`;
    await call("POST", "/api/me/push-subscriptions", a.cookie, subscription(endpoint));
    await t.db
      .update(schema.pushSubscriptions)
      .set({ lastOkAt: new Date() })
      .where(eq(schema.pushSubscriptions.endpoint, endpoint));
    const res = await call("POST", "/api/me/push-subscriptions", b.cookie, subscription(endpoint));
    expect(res.status).toBe(200);
    expect(((await res.json()) as PushSubscriptionView).lastOkAt).toBeNull();
    const listA = (await (await call("GET", "/api/me/push-subscriptions", a.cookie)).json()) as PushSubscriptionList;
    const listB = (await (await call("GET", "/api/me/push-subscriptions", b.cookie)).json()) as PushSubscriptionList;
    expect(listA.subscriptions).toEqual([]);
    expect(listB.subscriptions).toHaveLength(1);
  });

  it("refuses an endpoint that is not https", async () => {
    const a = await account();
    const res = await call("POST", "/api/me/push-subscriptions", a.cookie, subscription("http://push.test/x"));
    expect(res.status).toBe(400);
  });

  it("removes one of her devices, never another person's", async () => {
    const a = await account();
    const b = await account();
    const res = await call(
      "POST",
      "/api/me/push-subscriptions",
      a.cookie,
      subscription(`https://push.test/${++counter}`),
    );
    const { id } = (await res.json()) as PushSubscriptionView;
    expect((await call("DELETE", `/api/me/push-subscriptions/${id}`, b.cookie)).status).toBe(404);
    expect((await call("DELETE", `/api/me/push-subscriptions/${id}`, a.cookie)).status).toBe(204);
    expect((await call("DELETE", `/api/me/push-subscriptions/${id}`, a.cookie)).status).toBe(404);
  });
});

describe("/api/me/alert-settings", () => {
  it("reads the defaults, a guest too", async () => {
    const guest = await t.signIn();
    const res = await call("GET", "/api/me/alert-settings", guest.cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sizeBack: true, targetPrice: true, digest: true, digestHour: 18 });
  });

  it("refuses a guest's change", async () => {
    const guest = await t.signIn();
    const res = await call("PATCH", "/api/me/alert-settings", guest.cookie, { digest: false });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "account_required" });
  });

  it("changes and keeps her settings", async () => {
    const a = await account();
    const res = await call("PATCH", "/api/me/alert-settings", a.cookie, { sizeBack: false, digestHour: 9 });
    expect(res.status).toBe(200);
    const expected: AlertSettings = { sizeBack: false, targetPrice: true, digest: true, digestHour: 9 };
    expect(await res.json()).toEqual(expected);
    await call("PATCH", "/api/me/alert-settings", a.cookie, { digest: false });
    expect(await (await call("GET", "/api/me/alert-settings", a.cookie)).json()).toEqual({
      ...expected,
      digest: false,
    });
  });

  it("keeps the digest hour within 8–21 and refuses an empty change", async () => {
    const a = await account();
    for (const body of [{ digestHour: 7 }, { digestHour: 22 }, { digestHour: 12.5 }, {}]) {
      expect((await call("PATCH", "/api/me/alert-settings", a.cookie, body)).status).toBe(400);
    }
    for (const digestHour of [8, 21]) {
      expect((await call("PATCH", "/api/me/alert-settings", a.cookie, { digestHour })).status).toBe(200);
    }
  });
});

describe("/api/me/alerts", () => {
  it("lists all her alerts of the last 30 days, newest first, whatever their status", async () => {
    const a = await account();
    const item = await wish(a.cookie);
    const now = Date.now();
    const at = (daysAgo: number) => new Date(now - daysAgo * 86_400_000);
    const sent = await itemEvent(item, a.userId, { status: "sent", createdAt: at(1) });
    const digest = await itemEvent(item, a.userId, {
      kind: "price_drop",
      sizeLabel: null,
      priceCents: 7000,
      previousCents: 8000,
      status: "digest",
      createdAt: at(2),
    });
    const skipped = await itemEvent(item, a.userId, { status: "skipped", createdAt: at(3) });
    const pending = await itemEvent(item, a.userId, { status: "pending", createdAt: at(0.1) });
    await itemEvent(item, a.userId, { createdAt: at(31) });
    const { alerts, nextCursor } = await page(a.cookie);
    expect(alerts.map((e) => e.id)).toEqual([pending.id, sent.id, digest.id, skipped.id]);
    expect(nextCursor).toBeNull();
    const drop = alerts.find((e) => e.id === digest.id);
    expect(drop).toMatchObject({
      kind: "price_drop",
      itemId: item.id,
      title: item.name,
      priceCents: 7000,
      previousCents: 8000,
      currency: "EUR",
      shopName: item.product.shop.name,
      href: `/produits/${item.product.id}?profil=${item.profileId}`,
      readAt: null,
    });
  });

  it("never shows another person's alerts", async () => {
    const a = await account();
    const b = await account();
    const item = await wish(a.cookie);
    await itemEvent(item, a.userId);
    expect((await page(b.cookie)).alerts).toEqual([]);
    // An event wrongly naming her item for someone else stays theirs and says nothing of the item.
    await itemEvent(item, b.userId);
    const [theirs] = (await page(b.cookie)).alerts;
    expect(theirs?.itemId).toBeNull();
    expect(theirs?.title).toBe("");
    expect(theirs?.href).toBe("/nouvelles");
  });

  it("leads to the item in its current profile", async () => {
    const a = await account();
    const item = await wish(a.cookie);
    await itemEvent(item, a.userId);
    const res = await call("POST", "/api/me/profiles", a.cookie, { name: "Léa", audience: "child", color: "sky" });
    expect(res.status).toBe(201);
    const profile = (await res.json()) as { id: string };
    expect((await call("POST", `/api/me/items/${item.id}/move`, a.cookie, { profileId: profile.id })).status).toBe(200);
    const [alert] = (await page(a.cookie)).alerts;
    expect(alert?.href).toBe(`/produits/${item.product.id}?profil=${profile.id}`);
  });

  it("names the shop of a promo and the sales of a sales alert", async () => {
    const a = await account();
    const promoShop = await shop({ name: "Maison Iris" });
    const [sales] = await t.db
      .insert(schema.salePeriods)
      .values({ name: "Soldes d'hiver", startsOn: "2027-01-06", endsOn: "2027-02-02" })
      .returning();
    await event({ userId: a.userId, kind: "shop_promo", shopId: promoShop.id, createdAt: new Date(Date.now() - 1000) });
    await event({ userId: a.userId, kind: "sale_period", salePeriodId: sales?.id });
    const { alerts } = await page(a.cookie);
    expect(alerts.map((e) => [e.kind, e.title, e.href, e.startsOn])).toEqual([
      ["sale_period", "Soldes d'hiver", "/nouvelles", "2027-01-06"],
      ["shop_promo", "Maison Iris", "/nouvelles", null],
    ]);
  });

  it("pages with a cursor and refuses a forged one", async () => {
    const a = await account();
    const item = await wish(a.cookie);
    const base = Date.now() - 60_000;
    for (let i = 0; i < 32; i++) await itemEvent(item, a.userId, { createdAt: new Date(base - i * 1000) });
    const first = await page(a.cookie);
    expect(first.alerts).toHaveLength(30);
    expect(first.nextCursor).not.toBeNull();
    const second = await page(a.cookie, first.nextCursor ?? "");
    expect(second.alerts).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.alerts, ...second.alerts].map((e) => e.id)).size).toBe(32);
    const forged = Buffer.from(JSON.stringify(["'; drop table x", "nope"])).toString("base64url");
    expect((await call("GET", `/api/me/alerts?cursor=${forged}`, a.cookie)).status).toBe(400);
  });

  it("marks hers as read, never another person's", async () => {
    const a = await account();
    const b = await account();
    const item = await wish(a.cookie);
    const one = await itemEvent(item, a.userId);
    const two = await itemEvent(item, a.userId);
    const theirs = await event({ userId: b.userId, kind: "shop_promo", shopId: (await shop()).id });
    const res = await call("POST", "/api/me/alerts/read", a.cookie, { ids: [one.id, theirs.id] });
    expect(await res.json()).toEqual({ read: 1 });
    expect((await page(b.cookie)).alerts[0]?.readAt).toBeNull();
    expect(await (await call("POST", "/api/me/alerts/read", a.cookie, {})).json()).toEqual({ read: 1 });
    const read = (await page(a.cookie)).alerts;
    expect(read.every((e) => e.readAt !== null)).toBe(true);
    expect(read.map((e) => e.id).sort()).toEqual([one.id, two.id].sort());
  });
});

describe("item alert fields", () => {
  async function patch(cookie: string, id: string, body: unknown) {
    return call("PATCH", `/api/me/items/${id}`, cookie, body);
  }

  it("sets « M'alerter » and the target price, and clears the price with null", async () => {
    const a = await account();
    const item = await wish(a.cookie);
    expect(item).toMatchObject({ alertsEnabled: true, targetPriceCents: null, alertState: "watching" });
    const set = await patch(a.cookie, item.id, { targetPriceCents: 6000, alertsEnabled: false });
    expect(set.status).toBe(200);
    const changed = (await set.json()) as ItemMutationResult;
    expect(changed.item).toMatchObject({ alertsEnabled: false, targetPriceCents: 6000, alertState: "paused" });
    expect(changed.undo?.ops).toEqual([
      { ids: [item.id], op: "setFields", fields: { alertsEnabled: true, targetPriceCents: null } },
    ]);
    const cleared = (await (await patch(a.cookie, item.id, { targetPriceCents: null })).json()) as ItemMutationResult;
    expect(cleared.item.targetPriceCents).toBeNull();
    const [row] = await t.db.select().from(schema.items).where(eq(schema.items.id, item.id));
    expect(row?.targetPriceCents).toBeNull();
  });

  it("refuses a target price under 1 cent", async () => {
    const a = await account();
    const item = await wish(a.cookie);
    for (const targetPriceCents of [0, -5, 12.5]) {
      expect((await patch(a.cookie, item.id, { targetPriceCents })).status).toBe(400);
    }
  });

  it("is paused when her settings for it are off", async () => {
    const a = await account();
    const item = await wish(a.cookie);
    await call("PATCH", "/api/me/alert-settings", a.cookie, { sizeBack: false });
    const read = async () =>
      ((await (await call("GET", `/api/me/items/${item.id}`, a.cookie)).json()) as ItemView).alertState;
    expect(await read()).toBe("paused");
    // A target price still watched: she will hear of it.
    await patch(a.cookie, item.id, { targetPriceCents: 5000 });
    expect(await read()).toBe("watching");
    await call("PATCH", "/api/me/alert-settings", a.cookie, { targetPrice: false });
    expect(await read()).toBe("paused");
  });

  it("is impossible for a shop that blocks us, in lists too", async () => {
    const a = await account();
    const blocking = await wish(a.cookie, (await shop({ captureMode: "manual" })).id);
    const refused = await shop();
    const blocked = await wish(a.cookie, refused.id);
    await t.db.insert(schema.captures).values({
      shopId: refused.id,
      productId: blocked.product.id,
      url: blocked.product.canonicalUrl,
      status: "failed",
      errorCode: "robots_disallowed",
      trigger: "refresh",
    });
    const fine = await wish(a.cookie);
    const res = await call("GET", "/api/me/items?stage=spotted", a.cookie);
    const { items } = (await res.json()) as { items: ItemView[] };
    const state = new Map(items.map((i) => [i.id, i.alertState]));
    expect(state.get(blocking.id)).toBe("impossible");
    expect(state.get(blocked.id)).toBe("impossible");
    expect(state.get(fine.id)).toBe("watching");
  });

  it("watches her size, else her profile's for its kind, else any; tells when it was checked", async () => {
    const a = await account();
    const item = await wish(a.cookie);
    expect(item.watchedSizes).toBe("any");
    expect(item.checkedAt).toBeNull();
    const at = new Date("2026-11-14T10:00:00.000Z");
    await t.db.update(schema.products).set({ lastCapturedAt: at }).where(eq(schema.products.id, item.product.id));
    const sized = (await (await patch(a.cookie, item.id, { sizeLabel: "M" })).json()) as ItemMutationResult;
    expect(sized.item.watchedSizes).toEqual(["M"]);
    expect(sized.item.checkedAt).toBe(at.toISOString());
  });

  it("has no alert line once it is no longer a wish", async () => {
    const a = await account();
    const item = await wish(a.cookie);
    const res = await call("POST", `/api/me/items/${item.id}/stage`, a.cookie, {
      stage: "ordered",
      at: new Date().toISOString(),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ItemMutationResult).item.alertState).toBeNull();
  });
});

describe("« Accueil »: sales and shop promo", () => {
  it("shows her sales and promo alerts of the week, once each", async () => {
    const a = await account();
    await wish(a.cookie);
    const promoShop = await shop({ name: "Atelier Margaux" });
    const [sales] = await t.db
      .insert(schema.salePeriods)
      .values({ name: "Soldes d'été", startsOn: "2027-06-23", endsOn: "2027-07-20" })
      .returning();
    const now = Date.now();
    await event({
      userId: a.userId,
      kind: "sale_period",
      salePeriodId: sales?.id,
      createdAt: new Date(now - 2 * 86_400_000),
    });
    await event({ userId: a.userId, kind: "sale_period", salePeriodId: sales?.id, createdAt: new Date(now - 1000) });
    await event({ userId: a.userId, kind: "shop_promo", shopId: promoShop.id, createdAt: new Date(now - 5000) });
    await event({
      userId: a.userId,
      kind: "shop_promo",
      shopId: (await shop()).id,
      createdAt: new Date(now - 8 * 86_400_000),
    });
    const other = await account();
    await event({ userId: other.userId, kind: "shop_promo", shopId: promoShop.id });
    const res = await call("GET", "/api/me/home", a.cookie);
    expect(res.status).toBe(200);
    const home = (await res.json()) as HomeView;
    const all = [...(home.une ? [home.une] : []), ...home.news];
    expect(all.map((n) => [n.kind, n.title, n.href, n.startsOn])).toEqual([
      ["sale_period", "Soldes d'été", "/nouvelles", "2027-06-23"],
      ["shop_promo", "Atelier Margaux", "/nouvelles", null],
    ]);
  });
});
