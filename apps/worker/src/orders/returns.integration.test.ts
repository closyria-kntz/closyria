import { and, createDb, eq, schema } from "@closyria/db";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PushMessage, PushSender } from "../alerts/push";
import { orderReceivedCheckTitle, returnReminderTitle, sendAlert } from "../alerts/send";
import { askReceived, ORDER_DAILY_CRON, orderDailyHandler, remindReturns } from "./returns";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let handle: ReturnType<typeof createDb>;
let counter = 0;

beforeAll(async () => {
  database = await createTestDatabase();
  handle = createDb(database.url, { max: 4 });
}, 60_000);

afterAll(async () => {
  await handle?.pool.end();
  await database?.stop();
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Sunday 15 November 2026, 9:00 in Paris (UTC+1): the daily run.
const now = new Date("2026-11-15T08:00:00Z");
const once = { lastAttempt: false };

function fakePush() {
  const messages: PushMessage[] = [];
  const push: PushSender = async (_target, message) => {
    messages.push(message);
    return "ok";
  };
  return { push, messages };
}

async function person() {
  const { db } = handle;
  const userId = `returns-user-${++counter}`;
  await db.insert(schema.user).values({ id: userId, name: "Camille", email: `${userId}@exemple.test` });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ userId, name: "Moi", audience: "women", color: "plum" })
    .returning();
  await db
    .insert(schema.pushSubscriptions)
    .values({ userId, endpoint: `https://fcm.googleapis.com/fcm/send/${userId}`, p256dh: "p", auth: "a" });
  return { userId, profileId: profile?.id as string };
}
type Person = Awaited<ReturnType<typeof person>>;

async function item(
  who: Person,
  values: { stage?: string; returnDeadline?: string | null; deleted?: boolean; name?: string } = {},
) {
  const [row] = await handle.db
    .insert(schema.items)
    .values({
      userId: who.userId,
      profileId: who.profileId,
      productId: null,
      nameOverride: values.name ?? "Robe Iris",
      stage: values.stage ?? "owned",
      returnDeadline: values.returnDeadline ?? null,
      deletedAt: values.deleted ? new Date(now.getTime() - DAY) : null,
    })
    .returning();
  return row?.id as string;
}

const reminders = (itemId: string) =>
  handle.db
    .select()
    .from(schema.alertEvents)
    .where(and(eq(schema.alertEvents.itemId, itemId), eq(schema.alertEvents.kind, "return_reminder")));

describe("return reminder", () => {
  it("runs every day at 9:00", () => {
    expect(ORDER_DAILY_CRON).toBe("0 9 * * *");
  });

  it("reminds once per item, 3 days before its deadline; catches up 1–2 days before; never after", async () => {
    const who = await person();
    const in3 = await item(who, { returnDeadline: "2026-11-18" });
    const in2 = await item(who, { returnDeadline: "2026-11-17" });
    const in1 = await item(who, { returnDeadline: "2026-11-16" });
    const today = await item(who, { returnDeadline: "2026-11-15" });
    const past = await item(who, { returnDeadline: "2026-11-10" });
    const in4 = await item(who, { returnDeadline: "2026-11-19" });
    const returned = await item(who, { returnDeadline: "2026-11-18", stage: "returned" });
    const sold = await item(who, { returnDeadline: "2026-11-18", stage: "sold" });
    const trashed = await item(who, { returnDeadline: "2026-11-18", deleted: true });

    expect(await remindReturns(handle.db, now)).toBeGreaterThanOrEqual(3);
    for (const id of [in3, in2, in1]) expect(await reminders(id)).toHaveLength(1);
    for (const id of [today, past, in4, returned, sold, trashed]) expect(await reminders(id)).toHaveLength(0);
    const [event] = await reminders(in3);
    expect(event?.profileId).toBe(who.profileId);
    expect(event?.status).toBe("pending");
    expect(event?.sendAfter?.toISOString()).toBe(now.toISOString());

    // The next day: nothing twice.
    await remindReturns(handle.db, new Date(now.getTime() + DAY));
    for (const id of [in3, in2, in1]) expect(await reminders(id)).toHaveLength(1);
    // in4 is now 3 days ahead.
    expect(await reminders(in4)).toHaveLength(1);
  });

  it("words it « Plus que 3 jours pour retourner {article} », « Retour possible jusqu'au {date} »", async () => {
    expect(returnReminderTitle("Robe Iris", 3)).toBe("Plus que 3 jours pour retourner Robe Iris");
    expect(returnReminderTitle("Robe Iris", 2)).toBe("Plus que 2 jours pour retourner Robe Iris");
    expect(returnReminderTitle("Robe Iris", 1)).toBe("Plus qu'un jour pour retourner Robe Iris");
    expect(returnReminderTitle(null, 3)).toBe("Plus que 3 jours pour retourner ton article");

    const who = await person();
    const id = await item(who, { returnDeadline: "2026-11-18", name: "Pull Marin" });
    await remindReturns(handle.db, now);
    const [event] = await reminders(id);
    const { push, messages } = fakePush();
    expect(await sendAlert({ db: handle.db, push }, event?.id as string, now, once)).toBe("sent");
    // An article without a product: its own sheet (Task 7).
    expect(messages[0]).toEqual({
      title: "Plus que 3 jours pour retourner Pull Marin",
      body: "Retour possible jusqu'au 18 novembre",
      url: `/articles/${id}`,
    });
  });

  it("is not sent once the item was returned, or held past its deadline window", async () => {
    const who = await person();
    const id = await item(who, { returnDeadline: "2026-11-18" });
    await remindReturns(handle.db, now);
    const [event] = await reminders(id);
    await handle.db.update(schema.items).set({ stage: "returned" }).where(eq(schema.items.id, id));
    const { push, messages } = fakePush();
    expect(await sendAlert({ db: handle.db, push }, event?.id as string, now, once)).toBe("skipped");
    expect(messages).toHaveLength(0);

    const late = await item(who, { returnDeadline: "2026-11-16" });
    await remindReturns(handle.db, now);
    const [lateEvent] = await reminders(late);
    // Sent only on the deadline's day or after: nothing to remind any more.
    expect(await sendAlert({ db: handle.db, push }, lateEvent?.id as string, new Date(now.getTime() + DAY), once)).toBe(
      "skipped",
    );
  });
});

describe("return reminders by batches", () => {
  it("writes every due reminder, a few at a time", async () => {
    const who = await person();
    const ids = [];
    for (let n = 0; n < 5; n++) ids.push(await item(who, { returnDeadline: "2026-11-17" }));
    await remindReturns(handle.db, now, 2);
    for (const id of ids) expect(await reminders(id)).toHaveLength(1);
  });
});

// --- « Tu as reçu ta commande ? » ---------------------------------------------------------------------------------

async function shop(name = "Maison Lune") {
  const n = ++counter;
  const [row] = await handle.db
    .insert(schema.shops)
    .values({ name, slug: `returns-shop-${n}`, platform: "shopify", status: "published" })
    .returning();
  return row?.id as string;
}

async function order(
  who: Person,
  options: {
    shopId?: string | null;
    shopName?: string | null;
    status?: "draft" | "confirmed" | "dismissed";
    confirmedAt?: Date | null;
    createdAt?: Date;
    itemStages?: string[];
    parcels?: { status: string; createdAt: Date; eventAt?: Date }[];
    askedAt?: Date | null;
    notYetAt?: Date | null;
    askedAgainAt?: Date | null;
  } = {},
) {
  const { db } = handle;
  const [row] = await db
    .insert(schema.orders)
    .values({
      userId: who.userId,
      profileId: who.profileId,
      shopId: options.shopId ?? null,
      shopName: options.shopName ?? null,
      status: options.status ?? "confirmed",
      source: "email",
      parseMethod: "known",
      confirmedAt: options.confirmedAt === undefined ? new Date(now.getTime() - 11 * DAY) : options.confirmedAt,
      createdAt: options.createdAt ?? new Date(now.getTime() - 12 * DAY),
      receivedAskedAt: options.askedAt ?? null,
      receivedNotYetAt: options.notYetAt ?? null,
      receivedAskedAgainAt: options.askedAgainAt ?? null,
    })
    .returning();
  const orderId = row?.id as string;
  for (const [position, stage] of (options.itemStages ?? ["ordered"]).entries()) {
    const itemId = await item(who, { stage });
    await db.insert(schema.orderLines).values({ orderId, itemId, name: `Article ${position}`, position });
  }
  for (const p of options.parcels ?? []) {
    const [parcel] = await db
      .insert(schema.parcels)
      .values({
        orderId,
        carrier: "colissimo",
        trackingNumber: `6A${String(++counter).padStart(11, "0")}`,
        status: p.status,
        checkUntil: new Date(now.getTime() + 20 * DAY),
        createdAt: p.createdAt,
      })
      .returning();
    if (p.eventAt) {
      await db
        .insert(schema.parcelEvents)
        .values({ parcelId: parcel?.id as string, at: p.eventAt, status: "in_transit", label: "Pris en charge" });
    }
  }
  return orderId;
}

const questions = (orderId: string) =>
  handle.db
    .select()
    .from(schema.alertEvents)
    .where(and(eq(schema.alertEvents.orderId, orderId), eq(schema.alertEvents.kind, "order_received_check")));
const orderRow = async (orderId: string) =>
  (await handle.db.select().from(schema.orders).where(eq(schema.orders.id, orderId)))[0];

describe("« Tu as reçu ta commande ? »", () => {
  it("asks 10 days after the first parcel's earliest step, its creation, else the validation", async () => {
    const who = await person();
    const ago = (days: number) => new Date(now.getTime() - days * DAY);
    // Shipped 10 days ago (its first step), created later: asked.
    const byEvent = await order(who, {
      parcels: [{ status: "in_transit", createdAt: ago(5), eventAt: ago(10) }],
      confirmedAt: ago(30),
    });
    // A parcel created 9 days ago without a step: not yet, though validated long ago.
    const byParcel = await order(who, { parcels: [{ status: "pending", createdAt: ago(9) }], confirmedAt: ago(30) });
    // No parcel: from its validation (11 days).
    const byConfirmation = await order(who);
    const recent = await order(who, { confirmedAt: ago(9) });
    // Parcels all unknown (no carrier answer, or none): asked as well.
    const unknown = await order(who, { parcels: [{ status: "unknown", createdAt: ago(12) }] });

    await askReceived(handle.db, now);

    expect(await questions(byEvent)).toHaveLength(1);
    expect(await questions(byParcel)).toHaveLength(0);
    expect(await questions(byConfirmation)).toHaveLength(1);
    expect(await questions(recent)).toHaveLength(0);
    expect(await questions(unknown)).toHaveLength(1);
    expect((await orderRow(byEvent))?.receivedAskedAt?.toISOString()).toBe(now.toISOString());
    const [event] = await questions(byEvent);
    expect(event?.profileId).toBe(who.profileId);
    expect(event?.sendAfter?.toISOString()).toBe(now.toISOString());
  });

  it("never asks about a delivered, received, draft or dismissed order", async () => {
    const who = await person();
    const ago = (days: number) => new Date(now.getTime() - days * DAY);
    const delivered = await order(who, {
      parcels: [
        { status: "delivered", createdAt: ago(15) },
        { status: "in_transit", createdAt: ago(15) },
      ],
    });
    const received = await order(who, { itemStages: ["owned"] });
    const noItems = await order(who, { itemStages: [] });
    const draft = await order(who, { status: "draft", confirmedAt: null });
    const dismissed = await order(who, { status: "dismissed", confirmedAt: null });
    await askReceived(handle.db, now);
    for (const id of [delivered, received, noItems, draft, dismissed]) expect(await questions(id)).toHaveLength(0);
  });

  it("asks once; after « Pas encore » once more at 20 days; then never", async () => {
    const who = await person();
    const ago = (days: number) => new Date(now.getTime() - days * DAY);
    const id = await order(who, { confirmedAt: ago(12) });
    await askReceived(handle.db, now);
    await askReceived(handle.db, now);
    expect(await questions(id)).toHaveLength(1);

    // No answer: never again.
    await askReceived(handle.db, new Date(now.getTime() + 30 * DAY));
    expect(await questions(id)).toHaveLength(1);

    const answered = await order(who, { confirmedAt: ago(19), askedAt: ago(9), notYetAt: ago(8) });
    await askReceived(handle.db, now);
    expect(await questions(answered)).toHaveLength(0);
    await askReceived(handle.db, new Date(now.getTime() + DAY));
    expect(await questions(answered)).toHaveLength(1);
    expect((await orderRow(answered))?.receivedAskedAgainAt?.toISOString()).toBe(
      new Date(now.getTime() + DAY).toISOString(),
    );
    await askReceived(handle.db, new Date(now.getTime() + 20 * DAY));
    expect(await questions(answered)).toHaveLength(1);
  });

  it("never lets orders not due yet fill the day's budget before due ones", async () => {
    const who = await person();
    const ago = (days: number) => new Date(now.getTime() - days * DAY);
    // Older, answered « Pas encore » 12 days after shipping: not due again before 20 days.
    const waiting = await order(who, { confirmedAt: ago(12), askedAt: ago(2), notYetAt: ago(1), createdAt: ago(40) });
    const due = await order(who, { confirmedAt: ago(11), createdAt: ago(11) });
    await askReceived(handle.db, now, 1);
    expect(await questions(waiting)).toHaveLength(0);
    expect(await questions(due)).toHaveLength(1);
  });

  it("words it « Tu as reçu ta commande {boutique} ? », and stays quiet once she answered or it arrived", async () => {
    expect(orderReceivedCheckTitle("Maison Lune")).toBe("Tu as reçu ta commande Maison Lune ?");
    expect(orderReceivedCheckTitle(null)).toBe("Tu as reçu ta commande ?");
    expect(orderReceivedCheckTitle("  ")).toBe("Tu as reçu ta commande ?");

    const who = await person();
    const shopId = await shop();
    const known = await order(who, { shopId });
    const typed = await order(who, { shopName: "Atelier Nuit" });
    const bare = await order(who);
    const answered = await order(who);
    await askReceived(handle.db, now);
    const { push, messages } = fakePush();
    const send = async (orderId: string) => {
      const [event] = await questions(orderId);
      return sendAlert({ db: handle.db, push }, event?.id as string, now, once);
    };
    expect(await send(known)).toBe("sent");
    expect(messages[0]).toEqual({
      title: "Tu as reçu ta commande Maison Lune ?",
      body: "Réponds « Oui » ou « Pas encore ».",
      url: `/mes-commandes#commande-${known}`,
    });
    expect(await send(typed)).toBe("sent");
    expect(messages[1]?.title).toBe("Tu as reçu ta commande Atelier Nuit ?");
    expect(await send(bare)).toBe("sent");
    expect(messages[2]?.title).toBe("Tu as reçu ta commande ?");

    // Answered « Pas encore » before the send (held at night): nothing to ask.
    await handle.db
      .update(schema.orders)
      .set({ receivedNotYetAt: new Date(now.getTime() + HOUR) })
      .where(eq(schema.orders.id, answered));
    const [event] = await questions(answered);
    expect(
      await sendAlert({ db: handle.db, push }, event?.id as string, new Date(now.getTime() + 2 * HOUR), once),
    ).toBe("skipped");
  });

  it("counts Paris days: shipped at 15:00 Paris, asked on the 10th day at 9:00, again on the 20th", async () => {
    const who = await person();
    const at9 = (day: string) => new Date(`${day}T09:00:00+01:00`);
    // Shipped 5 November at 15:00 Paris (its first step); the run of the 14th is too early, the 15th asks.
    const id = await order(who, {
      parcels: [
        {
          status: "in_transit",
          createdAt: new Date("2026-11-05T15:00:00+01:00"),
          eventAt: new Date("2026-11-05T15:00:00+01:00"),
        },
      ],
      confirmedAt: new Date("2026-11-01T10:00:00+01:00"),
    });
    await askReceived(handle.db, at9("2026-11-14"));
    expect(await questions(id)).toHaveLength(0);
    await askReceived(handle.db, at9("2026-11-15"));
    expect(await questions(id)).toHaveLength(1);
    await handle.db
      .update(schema.orders)
      .set({ receivedNotYetAt: at9("2026-11-16") })
      .where(eq(schema.orders.id, id));
    await askReceived(handle.db, at9("2026-11-24"));
    expect(await questions(id)).toHaveLength(1);
    await askReceived(handle.db, at9("2026-11-25"));
    expect(await questions(id)).toHaveLength(2);
  });

  it("« Pas encore » given after the 20th day: asked again the next morning", async () => {
    const who = await person();
    const ago = (days: number) => new Date(now.getTime() - days * DAY);
    const id = await order(who, { confirmedAt: ago(25), askedAt: ago(15), notYetAt: ago(0.5) });
    await askReceived(handle.db, now);
    expect(await questions(id)).toHaveLength(1);
    expect((await orderRow(id))?.receivedAskedAgainAt?.toISOString()).toBe(now.toISOString());
  });

  it("the daily job runs both and refuses data", async () => {
    let runs = 0;
    const handler = orderDailyHandler(async () => {
      runs += 1;
      return { reminders: 0, questions: 0 };
    });
    await handler([{ id: "j", data: {} }]);
    expect(runs).toBe(1);
    await expect(handler([{ id: "j", data: { x: 1 } }])).rejects.toThrow();
  });
});

describe("daily cap and quiet hours", () => {
  const sentAt = new Date(now.getTime() - HOUR);

  async function sizeBacksSent(who: Person, n: number) {
    const shopId = await shop();
    for (let k = 0; k < n; k++) {
      const [product] = await handle.db
        .insert(schema.products)
        .values({ shopId, canonicalUrl: `https://cap-${++counter}.test/p`, name: "Robe" })
        .returning();
      const [wish] = await handle.db
        .insert(schema.items)
        .values({ userId: who.userId, profileId: who.profileId, productId: product?.id as string, stage: "spotted" })
        .returning();
      await handle.db.insert(schema.alertEvents).values({
        userId: who.userId,
        profileId: who.profileId,
        itemId: wish?.id as string,
        productId: product?.id as string,
        kind: "size_back",
        status: "sent",
        sentAt,
        sendAfter: sentAt,
        createdAt: sentAt,
      });
    }
    return shopId;
  }

  it("order and parcel kinds go out after 5 stock alerts today, and never count toward the cap", async () => {
    const who = await person();
    const shopId = await sizeBacksSent(who, 5);
    const id = await item(who, { returnDeadline: "2026-11-18" });
    await remindReturns(handle.db, now);
    const [reminder] = await reminders(id);
    const { push, messages } = fakePush();
    expect(await sendAlert({ db: handle.db, push }, reminder?.id as string, now, once)).toBe("sent");
    const orderId = await order(who, { shopId });
    await askReceived(handle.db, now);
    const [question] = await questions(orderId);
    expect(await sendAlert({ db: handle.db, push }, question?.id as string, now, once)).toBe("sent");
    expect(messages).toHaveLength(2);

    // Six order kinds sent today: a stock alert still goes out (they do not count).
    const other = await person();
    const otherShop = await shop();
    for (let k = 0; k < 6; k++) {
      const oid = await order(other, { shopId: otherShop });
      await handle.db.insert(schema.alertEvents).values({
        userId: other.userId,
        profileId: other.profileId,
        orderId: oid,
        kind: "order_received",
        status: "sent",
        sentAt,
        sendAfter: sentAt,
        createdAt: sentAt,
      });
    }
    const [product] = await handle.db
      .insert(schema.products)
      .values({ shopId: otherShop, canonicalUrl: `https://cap-${++counter}.test/p`, name: "Robe" })
      .returning();
    const [wish] = await handle.db
      .insert(schema.items)
      .values({ userId: other.userId, profileId: other.profileId, productId: product?.id as string, stage: "spotted" })
      .returning();
    const [sizeBack] = await handle.db
      .insert(schema.alertEvents)
      .values({
        userId: other.userId,
        profileId: other.profileId,
        itemId: wish?.id as string,
        productId: product?.id as string,
        kind: "size_back",
        sizeLabel: "M",
        sendAfter: now,
        createdAt: now,
      })
      .returning();
    expect(await sendAlert({ db: handle.db, push }, sizeBack?.id as string, now, once)).toBe("sent");
  });

  it("a stock alert past the cap still goes to the digest", async () => {
    const who = await person();
    const shopId = await sizeBacksSent(who, 5);
    const [product] = await handle.db
      .insert(schema.products)
      .values({ shopId, canonicalUrl: `https://cap-${++counter}.test/p`, name: "Robe" })
      .returning();
    const [wish] = await handle.db
      .insert(schema.items)
      .values({ userId: who.userId, profileId: who.profileId, productId: product?.id as string, stage: "spotted" })
      .returning();
    const [sixth] = await handle.db
      .insert(schema.alertEvents)
      .values({
        userId: who.userId,
        profileId: who.profileId,
        itemId: wish?.id as string,
        productId: product?.id as string,
        kind: "size_back",
        sizeLabel: "M",
        sendAfter: now,
        createdAt: now,
      })
      .returning();
    const { push } = fakePush();
    expect(await sendAlert({ db: handle.db, push }, sixth?.id as string, now, once)).toBe("digest");
  });

  it("quiet hours still hold them until 8:00 Paris", async () => {
    const who = await person();
    const id = await item(who, { returnDeadline: "2026-11-18" });
    await remindReturns(handle.db, now);
    const [reminder] = await reminders(id);
    const night = new Date("2026-11-15T23:30:00+01:00");
    const { push, messages } = fakePush();
    expect(await sendAlert({ db: handle.db, push }, reminder?.id as string, night, once)).toBe("held");
    expect(messages).toHaveLength(0);
    const [row] = await reminders(id);
    expect(row?.sendAfter?.toISOString()).toBe(new Date("2026-11-16T08:00:00+01:00").toISOString());
    expect(row?.status).toBe("pending");
  });
});
