import { eq, inArray, schema } from "@closyria/db";
import type { HomeView, ItemView, OrderList, OrderView, OwnerGroupOrder, WishlistView } from "@closyria/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";

/**
 * « Après la commande », Task 7: what the screens need from the API — a carrier corrected on a parcel, the e-mails
 * nothing could read, the return deadline on an article, the return reminder as the « une », and articles without a
 * product in her lists, the shop filter and her friends' view.
 */

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let counter = 0;
// Sunday 15 November 2026, 10:00 in Paris.
const NOW = new Date("2026-11-15T09:00:00Z");
const DAY = 86_400_000;
const HOUR = 3_600_000;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness({ now: () => NOW });
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

function call(method: string, path: string, cookie: string | undefined, body?: unknown) {
  return t.app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

async function json<T>(res: Response, status: number): Promise<T> {
  const text = await res.text();
  expect(res.status, text).toBe(status);
  return JSON.parse(text) as T;
}

async function account() {
  const session = await t.signIn();
  await t.db
    .update(schema.user)
    .set({ isAnonymous: false, name: "Marie Test", email: `screens${++counter}@t.local`, emailVerified: true })
    .where(eq(schema.user.id, session.userId));
  const profiles = await json<{ profiles: { id: string }[] }>(
    await call("GET", "/api/me/profiles", session.cookie),
    200,
  );
  const moi = profiles.profiles[0]?.id;
  if (!moi) throw new Error("no profile");
  return { ...session, moi };
}
type Account = Awaited<ReturnType<typeof account>>;

async function shop(name = "Maison Lune") {
  const [row] = await t.db
    .insert(schema.shops)
    .values({ name, slug: `screens-shop-${++counter}`, status: "published" })
    .returning();
  return row?.id as string;
}

/** A validated order of one article without a product, with a parcel in `status`. */
async function orderWithParcel(
  a: Account,
  parcel: { carrier: "colissimo" | null; status: string; checkUntil?: Date; failures?: number },
  shopId: string | null = null,
) {
  const [order] = await t.db
    .insert(schema.orders)
    .values({ userId: a.userId, profileId: a.moi, shopId, status: "confirmed", source: "email", parseMethod: "known" })
    .returning();
  const [item] = await t.db
    .insert(schema.items)
    .values({ userId: a.userId, profileId: a.moi, productId: null, nameOverride: "Robe Iris", stage: "ordered" })
    .returning();
  await t.db.insert(schema.orderLines).values({ orderId: order?.id as string, itemId: item?.id, name: "Robe Iris" });
  const [row] = await t.db
    .insert(schema.parcels)
    .values({
      orderId: order?.id as string,
      carrier: parcel.carrier,
      trackingNumber: `12345${String(++counter).padStart(3, "0")}`,
      status: parcel.status,
      nextCheckAt: null,
      checkFailures: parcel.failures ?? 3,
      checkUntil: parcel.checkUntil ?? new Date(NOW.getTime() + 20 * DAY),
    })
    .returning();
  return { orderId: order?.id as string, itemId: item?.id as string, parcelId: row?.id as string };
}

const parcelRow = async (id: string) => (await t.db.select().from(schema.parcels).where(eq(schema.parcels.id, id)))[0];

describe("GET /api/me/orders", () => {
  it("gives each parcel the carrier's latest step", async () => {
    const a = await account();
    const { parcelId } = await orderWithParcel(a, { carrier: "colissimo", status: "in_transit" });
    await t.db.insert(schema.parcelEvents).values([
      { parcelId, at: new Date(NOW.getTime() - 5 * HOUR), status: "in_transit", label: "Pris en charge" },
      { parcelId, at: new Date(NOW.getTime() - HOUR), status: "in_transit", label: "En cours d'acheminement" },
    ]);
    const list = await json<OrderList>(await call("GET", "/api/me/orders", a.cookie), 200);
    const parcel = list.orders.flatMap((o) => o.parcels).find((p) => p.id === parcelId);
    expect(parcel?.lastEventLabel).toBe("En cours d'acheminement");
  });
});

describe("the shop's name read in the e-mail (2026-11-15)", () => {
  it("shows it while the order's shop is still pending, the catalogue's name once approved", async () => {
    const a = await account();
    const [pending] = await t.db
      .insert(schema.shops)
      .values({ name: "lolaandco.example", slug: `screens-pending-${++counter}`, status: "pending" })
      .returning();
    const approvedId = await shop("Lola & Co Paris");
    const fromEmail = await orderWithParcel(a, { carrier: "colissimo", status: "pending" }, pending?.id as string);
    const approved = await orderWithParcel(a, { carrier: "colissimo", status: "pending" }, approvedId);
    const plain = await orderWithParcel(a, { carrier: "colissimo", status: "pending" }, pending?.id as string);
    await t.db
      .update(schema.orders)
      .set({ shopName: "Lola & Co" })
      .where(inArray(schema.orders.id, [fromEmail.orderId, approved.orderId]));

    const list = await json<OrderList>(await call("GET", "/api/me/orders", a.cookie), 200);
    const nameOf = (id: string) => list.orders.find((o) => o.id === id)?.shopName;
    expect(nameOf(fromEmail.orderId)).toBe("Lola & Co");
    expect(nameOf(approved.orderId)).toBe("Lola & Co Paris");
    // No name read: the pending shop's own (its domain).
    expect(nameOf(plain.orderId)).toBe("lolaandco.example");
    // Never written on the shared catalogue.
    expect(
      (
        await t.db
          .select()
          .from(schema.shops)
          .where(eq(schema.shops.id, pending?.id as string))
      )[0]?.name,
    ).toBe("lolaandco.example");

    // « Nouvelles » names it the same way.
    await t.db.insert(schema.alertEvents).values([
      {
        userId: a.userId,
        profileId: a.moi,
        kind: "parcel_delivered",
        orderId: fromEmail.orderId,
        parcelId: fromEmail.parcelId,
        shopId: pending?.id as string,
        status: "sent",
      },
      {
        userId: a.userId,
        profileId: a.moi,
        kind: "parcel_delivered",
        orderId: approved.orderId,
        parcelId: approved.parcelId,
        shopId: approvedId,
        status: "sent",
      },
    ]);
    const news = await json<{ alerts: { kind: string; title: string; shopName: string | null }[] }>(
      await call("GET", "/api/me/alerts", a.cookie),
      200,
    );
    expect(news.alerts.map((n) => n.shopName).sort()).toEqual(["Lola & Co", "Lola & Co Paris"]);

    // The sheet of an article without a product names its order's shop the same way.
    const sheet = await json<ItemView>(await call("GET", `/api/me/items/${fromEmail.itemId}`, a.cookie), 200);
    expect(sheet.shopName).toBe("Lola & Co");
  });
});

describe("PATCH /api/me/orders/{id}/parcels/{parcelId}", () => {
  it("sets the carrier she picked and starts the tracking again (pending, no failure, next check due)", async () => {
    const a = await account();
    const { orderId, parcelId } = await orderWithParcel(a, { carrier: null, status: "unknown" });
    const view = await json<OrderView>(
      await call("PATCH", `/api/me/orders/${orderId}/parcels/${parcelId}`, a.cookie, { carrier: "mondial_relay" }),
      200,
    );
    expect(view.parcels[0]).toMatchObject({ id: parcelId, carrier: "mondial_relay", status: "pending" });
    const row = await parcelRow(parcelId);
    expect(row).toMatchObject({ carrier: "mondial_relay", status: "pending", checkFailures: 0 });
    // Asked at the next sweep (2026-11-15: a correction shows its first steps within minutes), within its 30 days.
    expect(row?.nextCheckAt?.toISOString()).toBe(NOW.toISOString());
    expect(row?.checkUntil.toISOString()).toBe(new Date(NOW.getTime() + 20 * DAY).toISOString());
  });

  it("gives a tracking already over 30 more days", async () => {
    const a = await account();
    const { orderId, parcelId } = await orderWithParcel(a, {
      carrier: "colissimo",
      status: "unknown",
      checkUntil: new Date(NOW.getTime() - DAY),
    });
    await json<OrderView>(
      await call("PATCH", `/api/me/orders/${orderId}/parcels/${parcelId}`, a.cookie, { carrier: "chronopost" }),
      200,
    );
    const row = await parcelRow(parcelId);
    expect(row?.checkUntil.toISOString()).toBe(new Date(NOW.getTime() + 30 * DAY).toISOString());
    expect(row?.nextCheckAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("refuses a delivered parcel, a dismissed order, another account's parcel, a guest and a bad carrier", async () => {
    const a = await account();
    const delivered = await orderWithParcel(a, { carrier: "colissimo", status: "delivered" });
    const path = (o: { orderId: string; parcelId: string }) => `/api/me/orders/${o.orderId}/parcels/${o.parcelId}`;
    expect(await json(await call("PATCH", path(delivered), a.cookie, { carrier: "chronopost" }), 409)).toEqual({
      error: "parcel_delivered",
    });
    expect((await parcelRow(delivered.parcelId))?.carrier).toBe("colissimo");

    const dismissed = await orderWithParcel(a, { carrier: null, status: "unknown" });
    await t.db.update(schema.orders).set({ status: "dismissed" }).where(eq(schema.orders.id, dismissed.orderId));
    expect(await json(await call("PATCH", path(dismissed), a.cookie, { carrier: "gls" }), 409)).toEqual({
      error: "order_dismissed",
    });

    const other = await account();
    const theirs = await orderWithParcel(other, { carrier: null, status: "unknown" });
    expect(await json(await call("PATCH", path(theirs), a.cookie, { carrier: "gls" }), 404)).toEqual({
      error: "not_found",
    });
    // A parcel of another of her orders under this order's address: not found either.
    const mine = await orderWithParcel(a, { carrier: null, status: "unknown" });
    expect(
      await json(
        await call("PATCH", `/api/me/orders/${mine.orderId}/parcels/${dismissed.parcelId}`, a.cookie, {
          carrier: "gls",
        }),
        404,
      ),
    ).toEqual({ error: "not_found" });
    expect(await json(await call("PATCH", path(mine), a.cookie, { carrier: "la_poste" }), 400)).toEqual({
      error: "invalid_request",
    });

    const guest = await t.signIn();
    expect(await json(await call("PATCH", path(mine), guest.cookie, { carrier: "gls" }), 403)).toEqual({
      error: "account_required",
    });
  });
});

/** One more parcel on an order. */
async function addParcelRow(orderId: string, values: Partial<typeof schema.parcels.$inferInsert> = {}) {
  const [row] = await t.db
    .insert(schema.parcels)
    .values({
      orderId,
      carrier: "colissimo",
      trackingNumber: `6B${String(++counter).padStart(11, "0")}`,
      status: "in_transit",
      checkUntil: new Date(NOW.getTime() + 20 * DAY),
      ...values,
    })
    .returning();
  return row?.id as string;
}
const parcelPath = (o: { orderId: string; parcelId: string }) => `/api/me/orders/${o.orderId}/parcels/${o.parcelId}`;
const eventsOf = (parcelId: string) =>
  t.db.select().from(schema.parcelEvents).where(eq(schema.parcelEvents.parcelId, parcelId));
const parcelAlertsOf = (parcelId: string) =>
  t.db.select().from(schema.alertEvents).where(eq(schema.alertEvents.parcelId, parcelId));

describe("« Modifier le numéro »", () => {
  it("takes the new number, reads its carrier, and starts its tracking from scratch", async () => {
    const a = await account();
    const o = await orderWithParcel(a, { carrier: "colissimo", status: "in_transit", failures: 2 });
    await t.db
      .update(schema.parcels)
      .set({ lastEventAt: new Date(NOW.getTime() - HOUR), estimatedAt: new Date(NOW.getTime() + DAY) })
      .where(eq(schema.parcels.id, o.parcelId));
    await t.db.insert(schema.parcelEvents).values({
      parcelId: o.parcelId,
      at: new Date(NOW.getTime() - HOUR),
      status: "in_transit",
      label: "Pris en charge",
    });
    await t.db.insert(schema.alertEvents).values({
      userId: a.userId,
      profileId: a.moi,
      kind: "parcel_pickup_ready",
      orderId: o.orderId,
      parcelId: o.parcelId,
    });

    // Spaces, dashes and small letters are fine: « JJD » + 18 digits is DHL's own signature.
    const view = await json<OrderView>(
      await call("PATCH", parcelPath(o), a.cookie, { trackingNumber: " jjd 0001-23456789012345 " }),
      200,
    );
    expect(view.parcels).toEqual([
      expect.objectContaining({
        id: o.parcelId,
        trackingNumber: "JJD000123456789012345",
        carrier: "dhl",
        status: "pending",
        lastEventAt: null,
        lastEventLabel: null,
        estimatedAt: null,
      }),
    ]);
    const row = await parcelRow(o.parcelId);
    expect(row).toMatchObject({ checkFailures: 0, deliveredAt: null });
    // Asked at the next sweep, its 30 days counted again from now.
    expect(row?.nextCheckAt?.toISOString()).toBe(NOW.toISOString());
    expect(row?.checkUntil.toISOString()).toBe(new Date(NOW.getTime() + 30 * DAY).toISOString());
    // The old number's steps and notifications are gone.
    expect(await eventsOf(o.parcelId)).toHaveLength(0);
    expect(await parcelAlertsOf(o.parcelId)).toHaveLength(0);
    // Order and article stay.
    expect(view.lines).toHaveLength(1);
  });

  it("keeps her carrier for a number only it can confirm, takes the one she picks, and asks when it can't tell", async () => {
    const a = await account();
    const relay = await orderWithParcel(a, { carrier: "colissimo", status: "pending" });
    await t.db.update(schema.parcels).set({ carrier: "mondial_relay" }).where(eq(schema.parcels.id, relay.parcelId));
    await json(await call("PATCH", parcelPath(relay), a.cookie, { trackingNumber: "12345678" }), 200);
    expect(await parcelRow(relay.parcelId)).toMatchObject({ trackingNumber: "12345678", carrier: "mondial_relay" });

    const picked = await orderWithParcel(a, { carrier: "colissimo", status: "pending" });
    await json(
      await call("PATCH", parcelPath(picked), a.cookie, { trackingNumber: "12345678901", carrier: "gls" }),
      200,
    );
    expect(await parcelRow(picked.parcelId)).toMatchObject({ carrier: "gls", status: "pending" });

    // A shape no carrier signs, none picked: no carrier, as when she pastes one (she picks it on the screen).
    const unknown = await orderWithParcel(a, { carrier: "colissimo", status: "pending" });
    const view = await json<OrderView>(
      await call("PATCH", parcelPath(unknown), a.cookie, { trackingNumber: "ABC123456" }),
      200,
    );
    expect(view.parcels[0]).toMatchObject({ carrier: null, status: "unknown" });
    expect((await parcelRow(unknown.parcelId))?.nextCheckAt).toBeNull();
  });

  it("refuses a number another parcel of the order has, one of another order, and a malformed one", async () => {
    const a = await account();
    const o = await orderWithParcel(a, { carrier: "colissimo", status: "pending" });
    await addParcelRow(o.orderId, { trackingNumber: "6A18537412398" });
    expect(
      await json(await call("PATCH", parcelPath(o), a.cookie, { trackingNumber: "6A 1853 7412 398" }), 409),
    ).toEqual({ error: "parcel_exists" });
    const other = await orderWithParcel(a, { carrier: "colissimo", status: "pending" });
    await addParcelRow(other.orderId, { trackingNumber: "8R04217735096" });
    expect(await json(await call("PATCH", parcelPath(o), a.cookie, { trackingNumber: "8R04217735096" }), 409)).toEqual({
      error: "tracking_exists",
    });
    for (const trackingNumber of ["12345", "1".repeat(41), "ABC_123456"]) {
      expect(await json(await call("PATCH", parcelPath(o), a.cookie, { trackingNumber }), 400)).toEqual({
        error: "invalid_request",
      });
    }
    expect(await json(await call("PATCH", parcelPath(o), a.cookie, {}), 400)).toEqual({ error: "invalid_request" });
    const before = await parcelRow(o.parcelId);
    // The same number again: nothing changes.
    await json(await call("PATCH", parcelPath(o), a.cookie, { trackingNumber: before?.trackingNumber }), 200);
    expect(await parcelRow(o.parcelId)).toEqual(before);
  });
});

describe("« Supprimer ce suivi »", () => {
  it("deletes the parcel, its steps and its notifications; the order and its article stay", async () => {
    const a = await account();
    const o = await orderWithParcel(a, { carrier: "colissimo", status: "in_transit" });
    const kept = await addParcelRow(o.orderId);
    await t.db.insert(schema.parcelEvents).values({
      parcelId: o.parcelId,
      at: new Date(NOW.getTime() - HOUR),
      status: "in_transit",
      label: "Pris en charge",
    });
    await t.db.insert(schema.alertEvents).values({
      userId: a.userId,
      profileId: a.moi,
      kind: "parcel_out_for_delivery",
      orderId: o.orderId,
      parcelId: o.parcelId,
    });
    const view = await json<OrderView>(await call("DELETE", parcelPath(o), a.cookie), 200);
    expect(view.parcels.map((p) => p.id)).toEqual([kept]);
    expect(view.lines).toHaveLength(1);
    expect(await parcelRow(o.parcelId)).toBeUndefined();
    expect(await eventsOf(o.parcelId)).toHaveLength(0);
    expect(await parcelAlertsOf(o.parcelId)).toHaveLength(0);
    const [item] = await t.db.select().from(schema.items).where(eq(schema.items.id, o.itemId));
    expect(item?.stage).toBe("ordered");
    // Twice: gone already.
    expect(await json(await call("DELETE", parcelPath(o), a.cookie), 404)).toEqual({ error: "not_found" });
  });

  it("receives the order when the parcels left are all settled with one delivered", async () => {
    const a = await account();
    const o = await orderWithParcel(a, { carrier: "colissimo", status: "in_transit" });
    const deliveredAt = new Date(NOW.getTime() - 2 * DAY);
    await addParcelRow(o.orderId, { status: "delivered", deliveredAt, nextCheckAt: null });
    const view = await json<OrderView>(await call("DELETE", parcelPath(o), a.cookie), 200);
    expect(view.lines[0]?.itemStage).toBe("owned");
    const [item] = await t.db.select().from(schema.items).where(eq(schema.items.id, o.itemId));
    // 14 days from the delivery, in Paris.
    expect(item).toMatchObject({ stage: "owned", returnDeadline: "2026-11-27" });
  });

  it("never takes back what a delivered parcel brought", async () => {
    const a = await account();
    const o = await orderWithParcel(a, { carrier: "colissimo", status: "delivered" });
    await t.db
      .update(schema.items)
      .set({ stage: "owned", returnDeadline: "2026-11-29" })
      .where(eq(schema.items.id, o.itemId));
    await json(await call("DELETE", parcelPath(o), a.cookie), 200);
    const [item] = await t.db.select().from(schema.items).where(eq(schema.items.id, o.itemId));
    expect(item).toMatchObject({ stage: "owned", returnDeadline: "2026-11-29" });
  });

  it("refuses another account's parcel, a parcel under another order, a dismissed order and a guest", async () => {
    const a = await account();
    const other = await account();
    const theirs = await orderWithParcel(other, { carrier: "colissimo", status: "pending" });
    expect(await json(await call("DELETE", parcelPath(theirs), a.cookie), 404)).toEqual({ error: "not_found" });
    expect(await parcelRow(theirs.parcelId)).toBeDefined();
    const mine = await orderWithParcel(a, { carrier: "colissimo", status: "pending" });
    const second = await orderWithParcel(a, { carrier: "colissimo", status: "pending" });
    expect(
      await json(await call("DELETE", `/api/me/orders/${mine.orderId}/parcels/${second.parcelId}`, a.cookie), 404),
    ).toEqual({ error: "not_found" });
    await t.db.update(schema.orders).set({ status: "dismissed" }).where(eq(schema.orders.id, second.orderId));
    expect(await json(await call("DELETE", parcelPath(second), a.cookie), 409)).toEqual({ error: "order_dismissed" });
    const guest = await t.signIn();
    expect(await json(await call("DELETE", parcelPath(mine), guest.cookie), 403)).toEqual({
      error: "account_required",
    });
    expect(await parcelRow(mine.parcelId)).toBeDefined();
  });
});

describe("« On n'a pas su lire cet e-mail »", () => {
  async function failedEmail(a: Account, receivedAt: Date, options: { purgeAfter?: Date; status?: string } = {}) {
    const [inbox] = await t.db
      .insert(schema.orderInboxes)
      .values({ userId: a.userId, localPart: `marie-s${++counter}`, active: false })
      .returning();
    const [row] = await t.db
      .insert(schema.inboundEmails)
      .values({
        userId: a.userId,
        inboxId: inbox?.id as string,
        queueId: `q${counter}`,
        fromAddress: "marie@example.com",
        authOk: true,
        status: options.status ?? "failed",
        receivedAt,
        purgeAfter: options.purgeAfter ?? new Date(receivedAt.getTime() + 30 * DAY),
      })
      .returning();
    return row?.id as string;
  }

  it("lists her unreadable e-mails, newest first, until typed, set aside or purged", async () => {
    const a = await account();
    const older = await failedEmail(a, new Date(NOW.getTime() - 3 * DAY));
    const newer = await failedEmail(a, new Date(NOW.getTime() - HOUR));
    const typed = await failedEmail(a, new Date(NOW.getTime() - 2 * HOUR));
    await failedEmail(a, new Date(NOW.getTime() - 40 * DAY), { purgeAfter: new Date(NOW.getTime() - DAY) });
    await failedEmail(a, new Date(NOW.getTime() - HOUR), { status: "parsed" });
    const other = await account();
    const theirs = await failedEmail(other, new Date(NOW.getTime() - HOUR));

    await json<OrderView>(
      await call("POST", "/api/me/orders", a.cookie, {
        profileId: a.moi,
        shopName: "Atelier Mona",
        lines: [{ name: "Pull marin", quantity: 1 }],
        inboundEmailId: typed,
      }),
      201,
    );
    const list = await json<OrderList>(await call("GET", "/api/me/orders", a.cookie), 200);
    expect(list.unreadEmails).toEqual([
      { id: newer, receivedAt: new Date(NOW.getTime() - HOUR).toISOString() },
      { id: older, receivedAt: new Date(NOW.getTime() - 3 * DAY).toISOString() },
    ]);

    // « Ce n'est pas une commande »: no longer listed; twice is harmless; not another account's.
    const after = await json<OrderList>(await call("POST", `/api/me/order-emails/${older}/dismiss`, a.cookie), 200);
    expect(after.unreadEmails.map((e) => e.id)).toEqual([newer]);
    await json<OrderList>(await call("POST", `/api/me/order-emails/${older}/dismiss`, a.cookie), 200);
    expect(await json(await call("POST", `/api/me/order-emails/${theirs}/dismiss`, a.cookie), 404)).toEqual({
      error: "not_found",
    });
    // An e-mail she already typed cannot be set aside (its order stands).
    expect(await json(await call("POST", `/api/me/order-emails/${typed}/dismiss`, a.cookie), 404)).toEqual({
      error: "not_found",
    });
    const guest = await t.signIn();
    expect(await json(await call("POST", `/api/me/order-emails/${newer}/dismiss`, guest.cookie), 403)).toEqual({
      error: "account_required",
    });
  });
});

describe("articles after their order", () => {
  it("shows the return deadline on the article", async () => {
    const a = await account();
    const { itemId } = await orderWithParcel(a, { carrier: "colissimo", status: "delivered" });
    await t.db
      .update(schema.items)
      .set({ stage: "owned", returnDeadline: "2026-11-29" })
      .where(eq(schema.items.id, itemId));
    const item = await json<ItemView>(await call("GET", `/api/me/items/${itemId}`, a.cookie), 200);
    expect(item.returnDeadline).toBe("2026-11-29");
  });

  it("makes a due return reminder the « une » of « Accueil », photo or not, until it can no longer go back", async () => {
    const a = await account();
    const { itemId } = await orderWithParcel(a, { carrier: "colissimo", status: "delivered" });
    await t.db
      .update(schema.items)
      .set({ stage: "owned", returnDeadline: "2026-11-18" })
      .where(eq(schema.items.id, itemId));
    await t.db.insert(schema.alertEvents).values({
      userId: a.userId,
      profileId: a.moi,
      itemId,
      kind: "return_reminder",
      createdAt: new Date(NOW.getTime() - HOUR),
      status: "sent",
    });
    const home = await json<HomeView>(await call("GET", "/api/me/home", a.cookie), 200);
    expect(home.une).toMatchObject({
      kind: "return_reminder",
      itemId,
      title: "Robe Iris",
      href: `/articles/${itemId}`,
      returnDeadline: "2026-11-18",
      returnDaysLeft: 3,
      photoUrl: null,
    });

    // Sent back: no longer news.
    await t.db.update(schema.items).set({ stage: "returned" }).where(eq(schema.items.id, itemId));
    const later = await json<HomeView>(await call("GET", "/api/me/home", a.cookie), 200);
    expect(later.une).toBeNull();
    expect(later.news.filter((n) => n.kind === "return_reminder")).toEqual([]);
  });

  it("lists articles without a product in her lists, under their order's shop, and to her friends", async () => {
    const a = await account();
    const shopId = await shop("Atelier Nuit");
    const { itemId } = await orderWithParcel(a, { carrier: "colissimo", status: "pending" }, shopId);
    const list = await json<WishlistView>(
      await call("POST", "/api/me/wishlists", a.cookie, { name: "Pour l'été" }),
      201,
    );
    await json(await call("POST", `/api/me/wishlists/${list.id}/items`, a.cookie, { itemId }), 200);

    const inList = await json<{ items: ItemView[] }>(
      await call("GET", `/api/me/items?wishlist=${list.id}`, a.cookie),
      200,
    );
    expect(inList.items.map((i) => i.id)).toEqual([itemId]);

    // « Boutique »: the order's shop is offered, and finds the article.
    const facets = await json<{ shops: { id: string; name: string }[] }>(
      await call("GET", "/api/me/facets", a.cookie),
      200,
    );
    expect(facets.shops).toContainEqual({ id: shopId, name: "Atelier Nuit" });
    const byShop = await json<{ items: ItemView[] }>(await call("GET", `/api/me/items?shop=${shopId}`, a.cookie), 200);
    expect(byShop.items.map((i) => i.id)).toEqual([itemId]);

    // Her own brand for an article stays hers: neither the bare article's nor a product's without a catalogue brand.
    await t.db.update(schema.items).set({ brandOverride: "Maison Rosa" }).where(eq(schema.items.id, itemId));
    const [product] = await t.db
      .insert(schema.products)
      .values({ shopId, canonicalUrl: `https://atelier-nuit.test/p/${++counter}`, name: "Robe Lune", brand: null })
      .returning();
    const [withProduct] = await t.db
      .insert(schema.items)
      .values({
        userId: a.userId,
        profileId: a.moi,
        productId: product?.id as string,
        stage: "spotted",
        brandOverride: "Ma marque à moi",
      })
      .returning();
    await json(await call("POST", `/api/me/wishlists/${list.id}/items`, a.cookie, { itemId: withProduct?.id }), 200);

    // Her friends see it too: her name for it and the order's shop, no brand, no shop link, no private photo.
    const share = await json<{ url: string }>(await call("POST", `/api/me/wishlists/${list.id}/share`, a.cookie), 200);
    const shared = await json<{
      items: { itemId: string; name: string | null; shopName: string; url: string; imageUrl: string | null }[];
    }>(await call("GET", `/api/shared/${share.url.slice("/l/".length)}`, undefined), 200);
    expect(shared.items).toEqual([
      expect.objectContaining({
        itemId,
        name: "Robe Iris",
        brand: null,
        shopName: "Atelier Nuit",
        url: "",
        imageUrl: null,
      }),
      expect.objectContaining({ itemId: withProduct?.id, name: "Robe Lune", brand: null }),
    ]);
  });

  it("puts an article without a product in a group order of its order's shop (no sizes, no photo)", async () => {
    const a = await account();
    const shopId = await shop("Atelier Nuit");
    const { itemId } = await orderWithParcel(a, { carrier: "colissimo", status: "pending" }, shopId);
    const list = await json<WishlistView>(
      await call("POST", "/api/me/wishlists", a.cookie, { name: "Commande des copines" }),
      201,
    );
    await json(await call("POST", `/api/me/wishlists/${list.id}/items`, a.cookie, { itemId }), 200);
    await json(await call("POST", `/api/me/wishlists/${list.id}/share`, a.cookie), 200);

    const opened = await json<OwnerGroupOrder>(
      await call("POST", `/api/me/wishlists/${list.id}/group-order`, a.cookie, {
        shopId,
        shipping: { label: "Colissimo", shippingCents: 590, freeFromCents: null },
        deadline: null,
      }),
      201,
    );
    expect(opened.ownItems).toEqual([{ itemId, name: "Robe Iris", imageUrl: null, sizes: [] }]);

    const mine = await json<OwnerGroupOrder>(
      await call("PUT", `/api/me/group-orders/${opened.id}/own-lines`, a.cookie, {
        lines: [{ itemId, sizeLabel: "M", quantity: 1 }],
      }),
      200,
    );
    const owner = mine.people.find((p) => p.isOwner);
    expect(owner?.lines).toEqual([expect.objectContaining({ itemId, name: "Robe Iris" })]);
  });

  it("tells each line's article step: « Ajouter un numéro de suivi » only while still « Commandé »", async () => {
    const a = await account();
    const { orderId, itemId } = await orderWithParcel(a, { carrier: "colissimo", status: "in_transit" });
    const stageOf = async () =>
      (await json<OrderList>(await call("GET", "/api/me/orders", a.cookie), 200)).orders.find((o) => o.id === orderId)
        ?.lines[0]?.itemStage;
    expect(await stageOf()).toBe("ordered");
    await json(await call("POST", `/api/me/orders/${orderId}/received`, a.cookie, { answer: "yes" }), 200);
    expect(await stageOf()).toBe("owned");
    // Received: the API refuses a number on it, with its own code (the screen no longer offers it).
    expect(
      await json(
        await call("POST", `/api/me/items/${itemId}/tracking`, a.cookie, { trackingNumber: "6A12345678903" }),
        409,
      ),
    ).toEqual({ error: "item_not_ordered" });
    await t.db.update(schema.items).set({ deletedAt: NOW }).where(eq(schema.items.id, itemId));
    expect(await stageOf()).toBeNull();
  });
});
