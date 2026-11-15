import { and, eq, schema } from "@closyria/db";
import type { AlertPage, ItemMutationResult, ItemView, OrderList, OrderView } from "@closyria/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";

/** « Après la commande », Task 6: « Tu as reçu ta commande ? » answered, and Instagram links. */

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let counter = 0;
// Sunday 15 November 2026, 10:00 in Paris.
const NOW = new Date("2026-11-15T09:00:00Z");
const DAY = 86_400_000;

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
    .set({ isAnonymous: false, name: "Marie Test", email: `received${++counter}@t.local`, emailVerified: true })
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

/** A validated order of two articles « Commandé », with a parcel the carrier never found. */
async function confirmed(
  a: Account,
  options: { returnDays?: number | null; status?: "draft" | "confirmed" | "dismissed"; askedAt?: Date } = {},
) {
  let shopId: string | null = null;
  if (options.returnDays !== null) {
    const [shop] = await t.db
      .insert(schema.shops)
      .values({ name: "Maison Lune", slug: `received-shop-${++counter}`, returnDays: options.returnDays ?? 14 })
      .returning();
    shopId = shop?.id ?? null;
  }
  const [order] = await t.db
    .insert(schema.orders)
    .values({
      userId: a.userId,
      profileId: a.moi,
      shopId,
      status: options.status ?? "confirmed",
      source: "email",
      parseMethod: "known",
      confirmedAt: new Date(NOW.getTime() - 12 * DAY),
      receivedAskedAt: options.askedAt ?? null,
    })
    .returning();
  const orderId = order?.id as string;
  const itemIds: string[] = [];
  for (const [position, name] of ["Robe Iris", "Pull Marin"].entries()) {
    const [item] = await t.db
      .insert(schema.items)
      .values({ userId: a.userId, profileId: a.moi, productId: null, nameOverride: name, stage: "ordered" })
      .returning();
    itemIds.push(item?.id as string);
    await t.db.insert(schema.orderLines).values({ orderId, itemId: item?.id as string, name, position });
  }
  const [parcel] = await t.db
    .insert(schema.parcels)
    .values({
      orderId,
      carrier: "colissimo",
      trackingNumber: `6A${String(++counter).padStart(11, "0")}`,
      status: "unknown",
      nextCheckAt: new Date(NOW.getTime() + 6 * 3_600_000),
      checkUntil: new Date(NOW.getTime() + 18 * DAY),
    })
    .returning();
  return { orderId, itemIds, shopId, parcelId: parcel?.id as string };
}

const answer = (a: { cookie: string }, orderId: string, value: unknown) =>
  call("POST", `/api/me/orders/${orderId}/received`, a.cookie, { answer: value });

const itemRow = async (id: string) => (await t.db.select().from(schema.items).where(eq(schema.items.id, id)))[0];
const orderRow = async (id: string) => (await t.db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];

describe("POST /api/me/orders/{id}/received", () => {
  it("« Oui »: her articles go to « Reçu » now with the return deadline; the parcel is no longer checked", async () => {
    const a = await account();
    const { orderId, itemIds, parcelId } = await confirmed(a, { returnDays: 30, askedAt: NOW });
    const before = await json<OrderList>(await call("GET", "/api/me/orders", a.cookie), 200);
    expect(before.orders.find((o) => o.id === orderId)?.receivedQuestion).toBe(true);

    const view = await json<OrderView>(await answer(a, orderId, "yes"), 200);
    expect(view.id).toBe(orderId);
    expect(view.receivedQuestion).toBe(false);
    for (const id of itemIds) {
      const row = await itemRow(id);
      expect(row?.stage).toBe("owned");
      // 15 November (Paris) + 30 days.
      expect(row?.returnDeadline).toBe("2026-12-15");
      const events = await t.db
        .select()
        .from(schema.itemEvents)
        .where(and(eq(schema.itemEvents.itemId, id), eq(schema.itemEvents.stage, "owned")));
      expect(events.map((e) => e.at.toISOString())).toEqual([NOW.toISOString()]);
    }
    const sheet = await json<ItemView>(await call("GET", `/api/me/items/${itemIds[0]}`, a.cookie), 200);
    expect(sheet.received).toBe(true);
    const [parcel] = await t.db.select().from(schema.parcels).where(eq(schema.parcels.id, parcelId));
    expect(parcel?.nextCheckAt).toBeNull();
    expect(parcel?.checkUntil.getTime()).toBeLessThanOrEqual(NOW.getTime());

    // Twice: nothing moves again.
    await json<OrderView>(await answer(a, orderId, "yes"), 200);
    const events = await t.db
      .select()
      .from(schema.itemEvents)
      .where(eq(schema.itemEvents.itemId, itemIds[0] as string));
    expect(events.filter((e) => e.stage === "owned")).toHaveLength(1);
  });

  it("the question is no longer open once a parcel was delivered", async () => {
    const a = await account();
    const { orderId, parcelId } = await confirmed(a, { askedAt: NOW });
    await t.db
      .update(schema.parcels)
      .set({ status: "delivered", deliveredAt: NOW })
      .where(eq(schema.parcels.id, parcelId));
    const list = await json<OrderList>(await call("GET", "/api/me/orders", a.cookie), 200);
    expect(list.orders.find((o) => o.id === orderId)?.receivedQuestion).toBe(false);
  });

  it("« Oui » without a known shop: 14 days; an item received meanwhile keeps its stage, a returned one too", async () => {
    const a = await account();
    const { orderId, itemIds } = await confirmed(a, { returnDays: null });
    await t.db
      .update(schema.items)
      .set({ stage: "returned" })
      .where(eq(schema.items.id, itemIds[1] as string));
    await json<OrderView>(await answer(a, orderId, "yes"), 200);
    expect((await itemRow(itemIds[0] as string))?.returnDeadline).toBe("2026-11-29");
    const returned = await itemRow(itemIds[1] as string);
    expect(returned?.stage).toBe("returned");
    expect(returned?.returnDeadline).toBeNull();
  });

  it("« Pas encore »: kept for the question at 20 days; nothing moves", async () => {
    const a = await account();
    const { orderId, itemIds } = await confirmed(a, { askedAt: new Date(NOW.getTime() - DAY) });
    const view = await json<OrderView>(await answer(a, orderId, "not_yet"), 200);
    expect(view.receivedQuestion).toBe(false);
    expect((await orderRow(orderId))?.receivedNotYetAt?.toISOString()).toBe(NOW.toISOString());
    expect((await itemRow(itemIds[0] as string))?.stage).toBe("ordered");

    // Not asked yet: nothing recorded (the question at 10 days stays the first).
    const fresh = await confirmed(a);
    await json<OrderView>(await answer(a, fresh.orderId, "not_yet"), 200);
    expect((await orderRow(fresh.orderId))?.receivedNotYetAt).toBeNull();
  });

  it("refuses a draft or a dismissed order, another account's, a guest and a bad answer", async () => {
    const a = await account();
    const draft = await confirmed(a, { status: "draft" });
    expect(await json(await answer(a, draft.orderId, "yes"), 409)).toEqual({ error: "order_not_confirmed" });
    const dismissed = await confirmed(a, { status: "dismissed" });
    expect(await json(await answer(a, dismissed.orderId, "yes"), 409)).toEqual({ error: "order_dismissed" });
    expect((await itemRow(draft.itemIds[0] as string))?.stage).toBe("ordered");

    const other = await account();
    const theirs = await confirmed(other);
    expect(await json(await answer(a, theirs.orderId, "yes"), 404)).toEqual({ error: "not_found" });
    expect((await itemRow(theirs.itemIds[0] as string))?.stage).toBe("ordered");

    const guest = await t.signIn();
    expect(await json(await answer(guest, theirs.orderId, "yes"), 403)).toEqual({ error: "account_required" });

    expect(await json(await answer(a, theirs.orderId, "maybe"), 400)).toEqual({ error: "invalid_request" });
  });
});

describe("validation time", () => {
  it("« C'est bon » and a pasted number record when the order was validated (the J+10 question's last resort)", async () => {
    const a = await account();
    const [order] = await t.db
      .insert(schema.orders)
      .values({ userId: a.userId, profileId: a.moi, status: "draft", source: "email", parseMethod: "known" })
      .returning();
    await t.db.insert(schema.orderLines).values({ orderId: order?.id as string, name: "Robe Iris" });
    await json<OrderView>(await call("POST", `/api/me/orders/${order?.id}/confirm`, a.cookie), 200);
    expect((await orderRow(order?.id as string))?.confirmedAt?.toISOString()).toBe(NOW.toISOString());

    const [item] = await t.db
      .insert(schema.items)
      .values({ userId: a.userId, profileId: a.moi, productId: null, nameOverride: "Pull", stage: "ordered" })
      .returning();
    const created = await json<OrderView>(
      await call("POST", `/api/me/items/${item?.id}/tracking`, a.cookie, { trackingNumber: "6A12345678902" }),
      201,
    );
    expect((await orderRow(created.id))?.confirmedAt?.toISOString()).toBe(NOW.toISOString());
  });
});

describe("« Nouvelles »", () => {
  it("names the item of a return reminder, the shop of a received question", async () => {
    const a = await account();
    const { orderId, itemIds, shopId } = await confirmed(a);
    await t.db
      .update(schema.items)
      .set({ stage: "owned", returnDeadline: "2026-11-18" })
      .where(eq(schema.items.id, itemIds[0] as string));
    // A late reminder (the morning job missed a day): 2 days left, as its notification said.
    await t.db
      .update(schema.items)
      .set({ stage: "owned", returnDeadline: "2026-11-17" })
      .where(eq(schema.items.id, itemIds[1] as string));
    await t.db.insert(schema.alertEvents).values([
      { userId: a.userId, profileId: a.moi, itemId: itemIds[0], kind: "return_reminder", createdAt: NOW },
      { userId: a.userId, profileId: a.moi, itemId: itemIds[1], kind: "return_reminder", createdAt: NOW },
      { userId: a.userId, profileId: a.moi, orderId, shopId, kind: "order_received_check", createdAt: NOW },
    ]);
    const page = await json<AlertPage>(await call("GET", "/api/me/alerts", a.cookie), 200);
    const reminder = page.alerts.find((e) => e.kind === "return_reminder" && e.itemId === itemIds[0]);
    // Articles without a product: their own sheet (Task 7).
    expect(reminder).toMatchObject({ title: "Robe Iris", href: `/articles/${itemIds[0]}`, returnDaysLeft: 3 });
    const late = page.alerts.find((e) => e.kind === "return_reminder" && e.itemId === itemIds[1]);
    expect(late).toMatchObject({ title: "Pull Marin", returnDaysLeft: 2 });
    const question = page.alerts.find((e) => e.kind === "order_received_check");
    expect(question).toMatchObject({
      title: "Maison Lune",
      shopName: "Maison Lune",
      itemId: null,
      href: `/mes-commandes#commande-${orderId}`,
    });
  });
});

describe("Instagram links", () => {
  it("POST /api/captures: no capture, no shop, no network — the client shows the short form", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { cookie } = await t.signIn();
    const shopsBefore = await t.db.select({ id: schema.shops.id }).from(schema.shops);
    for (const url of [
      "https://www.instagram.com/p/C0ffee/?igsh=abc",
      "https://instagram.com/maisonlune",
      "https://instagr.am/p/C0ffee",
    ]) {
      const res = await call("POST", "/api/captures", cookie, { url });
      expect(await json(res, 200)).toEqual({ form: "instagram", url });
    }
    // Instagram's or Facebook's photo addresses: refused, never read.
    for (const url of ["https://scontent.cdninstagram.com/v/photo.jpg", "https://scontent.xx.fbcdn.net/p.jpg"]) {
      expect(await json(await call("POST", "/api/captures", cookie, { url }), 400)).toEqual({ error: "invalid_url" });
    }
    expect(t.calls).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await t.db.select({ id: schema.shops.id }).from(schema.shops)).toHaveLength(shopsBefore.length);
    fetchSpy.mockRestore();
  });

  it("POST /api/me/items/instagram: an article without a product, the link as its source, never read", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { cookie } = await t.signIn();
    const url = "https://www.instagram.com/p/C0ffee/";
    const ordered = await json<ItemMutationResult>(
      await call("POST", "/api/me/items/instagram", cookie, {
        url,
        action: "ordered",
        name: "Robe Iris",
        brand: "Maison Lune",
        priceCents: 4500,
        sizeLabel: "38",
        notes: "Vue en story",
      }),
      201,
    );
    expect(ordered.item).toMatchObject({
      product: null,
      stage: "ordered",
      name: "Robe Iris",
      brand: "Maison Lune",
      sizeLabel: "38",
      notes: "Vue en story",
      pricePaidCents: 4500,
      sourceUrl: url,
    });
    const [event] = await t.db.select().from(schema.itemEvents).where(eq(schema.itemEvents.itemId, ordered.item.id));
    expect(event).toMatchObject({ stage: "ordered", amountCents: 4500 });

    const wish = await json<ItemMutationResult>(
      await call("POST", "/api/me/items/instagram", cookie, { url, action: "wish", name: "Sac Lune" }),
      201,
    );
    expect(wish.item).toMatchObject({ product: null, stage: "spotted", loveLevel: 2, sourceUrl: url });
    // Undo sends it to the trash, like any creation.
    expect(wish.undo).not.toBeNull();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(t.calls).toEqual([]);
    fetchSpy.mockRestore();
  });

  it("refuses another site, a missing name, a price on a wish, another account's profile", async () => {
    const { cookie } = await t.signIn();
    const url = "https://www.instagram.com/p/C0ffee/";
    for (const body of [
      { url: "https://maison-lune.fr/products/robe", action: "wish", name: "Robe" },
      { url, action: "wish" },
      { url, action: "wish", name: "Robe", priceCents: 100 },
    ]) {
      expect(await json(await call("POST", "/api/me/items/instagram", cookie, body), 400)).toEqual({
        error: "invalid_request",
      });
    }
    const other = await account();
    expect(
      await json(
        await call("POST", "/api/me/items/instagram", cookie, {
          url,
          action: "wish",
          name: "Robe",
          profileId: other.moi,
        }),
        404,
      ),
    ).toEqual({ error: "not_found" });
  });
});
