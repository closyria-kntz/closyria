import { and, createDb, eq, schema } from "@closyria/db";
import { createTestDatabase } from "@closyria/testing/vitest";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { digestTopic, planDigests, sendDigest } from "./digest";
import { type PushMessage, type PushOutcome, PushRetryError, type PushSender, type PushTarget } from "./push";
import {
  ALERT_SEND_QUEUE,
  ALERT_SEND_QUEUE_OPTIONS,
  alertSendHandler,
  planAlertSends,
  sendAlert,
  sizeBackSentence,
} from "./send";

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

// Winter: Paris is UTC+1.
const paris = (day: string, time: string) => new Date(`${day}T${time}:00+01:00`);
const D = "2026-11-14";
const NEXT = "2026-11-15";
const afternoon = paris(D, "14:00");

/** A fake push service: records what it was asked and answers `outcome(endpoint)`. */
function fakePush(outcome: (endpoint: string) => PushOutcome = () => "ok") {
  const calls: { target: PushTarget; message: PushMessage; topic: string }[] = [];
  const push: PushSender = async (target, message, { topic }) => {
    calls.push({ target, message, topic });
    return outcome(target.endpoint);
  };
  return { push, calls };
}

async function person(
  options: { anonymous?: boolean; devices?: number; settings?: Partial<typeof schema.alertSettings.$inferInsert> } = {},
) {
  const { db } = handle;
  const userId = `send-user-${++counter}`;
  await db
    .insert(schema.user)
    .values({ id: userId, name: userId, email: `${userId}@example.test`, isAnonymous: options.anonymous ?? false });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ userId, name: "Moi", audience: "women", color: "plum" })
    .returning();
  if (!profile) throw new Error("no profile");
  const endpoints: string[] = [];
  for (let i = 0; i < (options.devices ?? 1); i++) {
    const endpoint = `https://push.example.test/${userId}/${i}`;
    await db.insert(schema.pushSubscriptions).values({ userId, endpoint, p256dh: "p256dh-key", auth: "auth-key" });
    endpoints.push(endpoint);
  }
  if (options.settings) await db.insert(schema.alertSettings).values({ userId, ...options.settings });
  return { userId, profileId: profile.id, endpoints };
}

async function wish(
  who: { userId: string; profileId: string },
  values: {
    name?: string | null;
    shopName?: string;
    currency?: string;
    targetPriceCents?: number;
    stage?: string;
  } = {},
) {
  const { db } = handle;
  const n = ++counter;
  const [shop] = await db
    .insert(schema.shops)
    .values({
      name: values.shopName ?? "Atelier Margaux",
      slug: `send-shop-${n}`,
      platform: "shopify",
      status: "published",
    })
    .returning();
  if (!shop) throw new Error("no shop");
  const [product] = await db
    .insert(schema.products)
    .values({
      shopId: shop.id,
      canonicalUrl: `https://send-${n}.example/p`,
      name: values.name === undefined ? "Robe Iris" : values.name,
      currency: values.currency ?? "EUR",
    })
    .returning();
  if (!product) throw new Error("no product");
  const [item] = await db
    .insert(schema.items)
    .values({
      userId: who.userId,
      profileId: who.profileId,
      productId: product.id,
      stage: values.stage ?? "spotted",
      targetPriceCents: values.targetPriceCents ?? null,
    })
    .returning();
  if (!item) throw new Error("no item");
  return { itemId: item.id, productId: product.id, shopId: shop.id };
}

type EventValues = Partial<typeof schema.alertEvents.$inferInsert>;

async function event(
  who: { userId: string; profileId: string },
  item: { itemId: string; productId: string } | null,
  values: EventValues & { kind: string },
) {
  const [row] = await handle.db
    .insert(schema.alertEvents)
    .values({
      userId: who.userId,
      ...(item ? { itemId: item.itemId, productId: item.productId, profileId: who.profileId } : {}),
      createdAt: afternoon,
      ...values,
    })
    .returning();
  if (!row) throw new Error("no event");
  return row.id;
}

const sizeBack = (
  who: { userId: string; profileId: string },
  item: { itemId: string; productId: string },
  at = afternoon,
) => event(who, item, { kind: "size_back", sizeLabel: "M", sendAfter: at, createdAt: at });

async function eventRow(id: string) {
  const [row] = await handle.db.select().from(schema.alertEvents).where(eq(schema.alertEvents.id, id));
  if (!row) throw new Error("event gone");
  return row;
}

const sends = (userId: string) =>
  handle.db.select().from(schema.alertSends).where(eq(schema.alertSends.userId, userId));
const devices = (userId: string) =>
  handle.db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, userId));

const once = { lastAttempt: false };

describe("sendAlert", () => {
  it("sends « Ta taille est revenue » to each of her devices and logs each attempt", async () => {
    const her = await person({ devices: 2 });
    const item = await wish(her);
    const id = await sizeBack(her, item);
    const { push, calls } = fakePush();

    expect(await sendAlert({ db: handle.db, push }, id, afternoon, once)).toBe("sent");

    expect(calls).toHaveLength(2);
    expect(calls[0]?.message).toEqual({
      title: "Ta taille est revenue",
      body: "Robe Iris : de retour en M chez Atelier Margaux",
      url: `/produits/${item.productId}?profil=${her.profileId}`,
    });
    const row = await eventRow(id);
    expect(row.status).toBe("sent");
    expect(row.sentAt?.toISOString()).toBe(afternoon.toISOString());
    expect(calls.map((c) => c.topic)).toEqual([id.replaceAll("-", ""), id.replaceAll("-", "")]);
    expect(calls[0]?.topic).toHaveLength(32);
    const logged = await sends(her.userId);
    expect(logged.map((s) => s.ok)).toEqual([true, true]);
    expect((await devices(her.userId)).every((d) => d.lastOkAt?.getTime() === afternoon.getTime())).toBe(true);
  });

  it("words a target price with her threshold", async () => {
    const her = await person();
    const item = await wish(her, { targetPriceCents: 6000 });
    const id = await event(her, item, {
      kind: "target_price",
      priceCents: 5900,
      previousCents: 7000,
      sendAfter: afternoon,
    });
    const { push, calls } = fakePush();

    expect(await sendAlert({ db: handle.db, push }, id, afternoon, once)).toBe("sent");
    expect(calls[0]?.message.title).toBe("Prix visé");
    expect(calls[0]?.message.body.replace(/\s/g, " ")).toBe("Robe Iris : 59 € (tu visais 60 €)");
  });

  it("keeps cents when the price has some, and a neutral subject without a name", async () => {
    const her = await person();
    const item = await wish(her, { targetPriceCents: 6000, name: null });
    const id = await event(her, item, {
      kind: "target_price",
      priceCents: 5990,
      previousCents: 7000,
      sendAfter: afternoon,
    });
    const { push, calls } = fakePush();

    await sendAlert({ db: handle.db, push }, id, afternoon, once);
    expect(calls[0]?.message.body.replace(/\s/g, " ")).toBe("Ton article : 59,90 € (tu visais 60 €)");
  });

  it("an alert born at 23:30 waits for 8:00 and counts in the cap of the day it goes out (RF 3)", async () => {
    const her = await person();
    const item = await wish(her);
    const { push, calls } = fakePush();
    const deps = { db: handle.db, push };
    // Day D: already 5 immediate notifications.
    for (let i = 0; i < 5; i++) {
      const id = await sizeBack(her, await wish(her), paris(D, "20:00"));
      expect(await sendAlert(deps, id, paris(D, "20:00"), once)).toBe("sent");
    }
    const night = paris(D, "23:30");
    const id = await event(her, item, {
      kind: "size_back",
      sizeLabel: "M",
      createdAt: night,
      sendAfter: paris(NEXT, "08:00"),
    });
    const queued: string[] = [];
    const queue = { send: async (_q: string, data: { eventId: string }) => void queued.push(data.eventId) };

    await planAlertSends(handle.db, queue, paris(D, "23:31"));
    await planAlertSends(handle.db, queue, paris(NEXT, "07:59"));
    expect(queued).not.toContain(id);
    // Even if a job runs early, nothing goes out in the quiet hours.
    expect(await sendAlert(deps, id, paris(NEXT, "07:59"), once)).toBe("held");
    expect(calls).toHaveLength(5);

    await planAlertSends(handle.db, queue, paris(NEXT, "08:00"));
    expect(queued).toContain(id);
    expect(await sendAlert(deps, id, paris(NEXT, "08:00"), once)).toBe("sent");
    expect(calls).toHaveLength(6);

    // It is the first of day D+1: four more go out, the sixth of the day goes to the digest.
    for (let i = 0; i < 4; i++) {
      const more = await sizeBack(her, await wish(her), paris(NEXT, "09:00"));
      expect(await sendAlert(deps, more, paris(NEXT, "09:00"), once)).toBe("sent");
    }
    const sixth = await sizeBack(her, await wish(her), paris(NEXT, "10:00"));
    expect(await sendAlert(deps, sixth, paris(NEXT, "10:00"), once)).toBe("digest");
    const row = await eventRow(sixth);
    expect(row.status).toBe("digest");
    expect(row.digestOn).toBe(NEXT);
    expect(calls).toHaveLength(10);
  });

  it("a job that runs late into the quiet hours is held until 8:00", async () => {
    const her = await person();
    const id = await sizeBack(her, await wish(her), paris(D, "21:59"));
    const { push, calls } = fakePush();

    expect(await sendAlert({ db: handle.db, push }, id, paris(D, "22:01"), once)).toBe("held");
    expect(calls).toHaveLength(0);
    const row = await eventRow(id);
    expect(row.status).toBe("pending");
    expect(row.sendAfter?.toISOString()).toBe(paris(NEXT, "08:00").toISOString());
  });

  it("a setting turned off since: skipped, never sent", async () => {
    const her = await person({ settings: { sizeBack: false } });
    const id = await sizeBack(her, await wish(her));
    const { push, calls } = fakePush();

    expect(await sendAlert({ db: handle.db, push }, id, afternoon, once)).toBe("skipped");
    expect(calls).toHaveLength(0);
    expect((await eventRow(id)).status).toBe("skipped");
  });

  it("a guest, a person without devices, or push off: skipped, the event stays for « Nouvelles »", async () => {
    const guest = await person({ anonymous: true });
    const noDevice = await person({ devices: 0 });
    const withDevice = await person();
    const { push, calls } = fakePush();

    const a = await sizeBack(guest, await wish(guest));
    const b = await sizeBack(noDevice, await wish(noDevice));
    const c = await sizeBack(withDevice, await wish(withDevice));
    expect(await sendAlert({ db: handle.db, push }, a, afternoon, once)).toBe("skipped");
    expect(await sendAlert({ db: handle.db, push }, b, afternoon, once)).toBe("skipped");
    // No VAPID keys: nothing is ever sent.
    expect(await sendAlert({ db: handle.db, push: null }, c, afternoon, once)).toBe("skipped");
    expect(calls).toHaveLength(0);
    for (const id of [a, b, c]) expect((await eventRow(id)).status).toBe("skipped");
  });

  it("an item no longer followed (ordered) since: skipped", async () => {
    const her = await person();
    const item = await wish(her);
    const id = await sizeBack(her, item);
    await handle.db.update(schema.items).set({ stage: "ordered" }).where(eq(schema.items.id, item.itemId));
    const { push, calls } = fakePush();

    expect(await sendAlert({ db: handle.db, push }, id, afternoon, once)).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("a device the browser removed (404/410) is deleted and not tried again (RF 4)", async () => {
    const her = await person({ devices: 3 });
    const [gone404, gone410, alive] = her.endpoints;
    const { push, calls } = fakePush((endpoint) =>
      endpoint === gone404 ? "gone" : endpoint === gone410 ? "gone" : "ok",
    );

    const id = await sizeBack(her, await wish(her));
    expect(await sendAlert({ db: handle.db, push }, id, afternoon, once)).toBe("sent");
    expect((await devices(her.userId)).map((d) => d.endpoint)).toEqual([alive]);
    expect((await sends(her.userId)).map((s) => s.ok).sort()).toEqual([false, false, true]);

    const next = await sizeBack(her, await wish(her));
    await sendAlert({ db: handle.db, push }, next, afternoon, once);
    expect(calls.slice(3).map((c) => c.target.endpoint)).toEqual([alive]);
  });

  it("only removed devices: the event is skipped, no retry", async () => {
    const her = await person();
    const { push } = fakePush(() => "gone");
    const id = await sizeBack(her, await wish(her));

    expect(await sendAlert({ db: handle.db, push }, id, afternoon, once)).toBe("skipped");
    expect(await devices(her.userId)).toHaveLength(0);
  });

  it("a busy push service (429/5xx) asks pg-boss for another try, then gives up on the last one", async () => {
    const her = await person();
    const { push } = fakePush(() => "retry");
    const id = await sizeBack(her, await wish(her));

    await expect(sendAlert({ db: handle.db, push }, id, afternoon, once)).rejects.toBeInstanceOf(PushRetryError);
    // The retry releases the claim: the next attempt sends again.
    expect(await eventRow(id)).toMatchObject({ status: "pending", sentAt: null });
    expect(await devices(her.userId)).toHaveLength(1);

    expect(await sendAlert({ db: handle.db, push }, id, afternoon, { lastAttempt: true })).toBe("skipped");
    expect((await sends(her.userId)).map((s) => s.ok)).toEqual([false, false]);
  });

  it("a job that dies between the claim and the status is not sent again", async () => {
    const her = await person();
    const id = await sizeBack(her, await wish(her));
    let pushes = 0;
    const crashing: PushSender = async () => {
      pushes += 1;
      throw new Error("worker killed");
    };
    await expect(sendAlert({ db: handle.db, push: crashing }, id, afternoon, once)).rejects.toThrow("worker killed");
    const claimed = await eventRow(id);
    expect(claimed.status).toBe("pending");
    expect(claimed.sentAt?.toISOString()).toBe(afternoon.toISOString());

    // The sweep queues it again; its job closes it as sent without pushing.
    const queued: string[] = [];
    await planAlertSends(
      handle.db,
      { send: async (_q, data) => void queued.push((data as { eventId: string }).eventId) },
      afternoon,
    );
    expect(queued).toContain(id);
    const { push, calls } = fakePush();
    expect(await sendAlert({ db: handle.db, push }, id, paris(D, "14:01"), once)).toBe("sent");
    expect(calls).toHaveLength(0);
    expect(pushes).toBe(1);
    expect(await eventRow(id)).toMatchObject({ status: "sent" });
  });

  it("links to the item's profile now, not the one at the event", async () => {
    const her = await person();
    const item = await wish(her);
    const id = await sizeBack(her, item);
    const [other] = await handle.db
      .insert(schema.profiles)
      .values({ userId: her.userId, name: "Léa", audience: "women", color: "sage" })
      .returning();
    await handle.db.update(schema.items).set({ profileId: other?.id }).where(eq(schema.items.id, item.itemId));
    const { push, calls } = fakePush();

    await sendAlert({ db: handle.db, push }, id, afternoon, once);
    expect(calls[0]?.message.url).toBe(`/produits/${item.productId}?profil=${other?.id}`);
  });

  it("words a size back without a shop or without a size", () => {
    expect(sizeBackSentence("Robe Iris", "M", null)).toBe("Robe Iris : de retour en M");
    expect(sizeBackSentence("Sac Lune", null, "Maison Iris")).toBe("Sac Lune : de retour en stock chez Maison Iris");
    expect(sizeBackSentence(null, "M", "Maison Iris")).toBe("Ton article : de retour en M chez Maison Iris");
  });

  it("an event already handled is left alone", async () => {
    const her = await person();
    const id = await sizeBack(her, await wish(her));
    const { push, calls } = fakePush();
    await sendAlert({ db: handle.db, push }, id, afternoon, once);
    expect(await sendAlert({ db: handle.db, push }, id, afternoon, once)).toBe("none");
    expect(calls).toHaveLength(1);
  });
});

describe("alert-send queue", () => {
  it("pg-boss tries a busy push service 3 more times, then the event is skipped", async () => {
    const boss = new PgBoss({ connectionString: database.url, max: 3 });
    boss.on("error", () => {});
    await boss.start();
    try {
      const her = await person();
      const id = await sizeBack(her, await wish(her));
      const { push, calls } = fakePush(() => "retry");
      await boss.createQueue(ALERT_SEND_QUEUE, { ...ALERT_SEND_QUEUE_OPTIONS, retryDelay: 0, retryBackoff: false });
      await boss.work(
        ALERT_SEND_QUEUE,
        { includeMetadata: true, pollingIntervalSeconds: 0.5 },
        alertSendHandler({ db: handle.db, push }, () => afternoon),
      );
      await boss.send(ALERT_SEND_QUEUE, { eventId: id }, { singletonKey: id });

      const deadline = Date.now() + 30_000;
      while ((await eventRow(id)).status === "pending" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect((await eventRow(id)).status).toBe("skipped");
      expect(calls).toHaveLength(4);
    } finally {
      await boss.stop({ graceful: false, timeout: 1000 }).catch(() => {});
    }
  }, 40_000);
});

describe("digest", () => {
  const evening = paris(D, "18:00");
  const queueSpy = () => {
    const users: string[] = [];
    return { users, queue: { send: async (_q: string, data: { userId: string }) => void users.push(data.userId) } };
  };

  it("one grouped notification at her hour: drops, sales and promos, then nothing more that day", async () => {
    const her = await person();
    for (let i = 0; i < 3; i++) {
      await event(her, await wish(her), { kind: "price_drop", priceCents: 8000, previousCents: 10000, digestOn: D });
    }
    const [period] = await handle.db
      .insert(schema.salePeriods)
      .values({ name: "Soldes d'hiver", startsOn: "2026-11-16", endsOn: "2026-12-10" })
      .returning();
    await event(her, null, { kind: "sale_period", salePeriodId: period?.id, digestOn: D });
    const promo = await wish(her, { shopName: "Maison Iris" });
    await event(her, null, { kind: "shop_promo", shopId: promo.shopId, digestOn: D });
    const { push, calls } = fakePush();

    const early = queueSpy();
    await planDigests(handle.db, early.queue, paris(D, "17:45"));
    expect(early.users).not.toContain(her.userId);

    const due = queueSpy();
    await planDigests(handle.db, due.queue, evening);
    expect(due.users).toContain(her.userId);
    expect(await sendDigest({ db: handle.db, push }, her.userId, evening, once)).toBe("sent");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.message).toEqual({
      title: "3 baisses de prix dans tes envies",
      body: "Les soldes commencent lundi\nMaison Iris est en promo",
      url: "/nouvelles",
    });
    const rows = await handle.db.select().from(schema.alertEvents).where(eq(schema.alertEvents.userId, her.userId));
    expect(rows.every((r) => r.status === "sent")).toBe(true);

    // A drop later that evening waits for tomorrow's digest: one digest a day.
    await event(her, await wish(her), {
      kind: "price_drop",
      priceCents: 8000,
      previousCents: 10000,
      digestOn: D,
      createdAt: paris(D, "18:10"),
    });
    const again = queueSpy();
    await planDigests(handle.db, again.queue, paris(D, "18:15"));
    expect(again.users).not.toContain(her.userId);
    const tomorrow = queueSpy();
    await planDigests(handle.db, tomorrow.queue, paris(NEXT, "18:00"));
    expect(tomorrow.users).toContain(her.userId);
    expect(await sendDigest({ db: handle.db, push }, her.userId, paris(NEXT, "18:00"), once)).toBe("sent");
    expect(calls[1]?.message.title).toBe("1 baisse de prix dans tes envies");
  });

  it("follows her digest hour", async () => {
    const her = await person({ settings: { digestHour: 9 } });
    await event(her, await wish(her), { kind: "price_drop", priceCents: 8000, previousCents: 10000, digestOn: D });
    const at8 = queueSpy();
    await planDigests(handle.db, at8.queue, paris(D, "08:45"));
    expect(at8.users).not.toContain(her.userId);
    const at9 = queueSpy();
    await planDigests(handle.db, at9.queue, paris(D, "09:00"));
    expect(at9.users).toContain(her.userId);
    const at18 = queueSpy();
    await planDigests(handle.db, at18.queue, evening);
    expect(at18.users).not.toContain(her.userId);
  });

  it("a target price sent to the digest by the cap counts as a drop; a size back gets its own line", async () => {
    const her = await person();
    await event(her, await wish(her), { kind: "price_drop", priceCents: 8000, previousCents: 10000, digestOn: D });
    await event(her, await wish(her, { targetPriceCents: 6000 }), {
      kind: "target_price",
      priceCents: 5900,
      previousCents: 7000,
      status: "digest",
      digestOn: D,
    });
    await event(her, await wish(her, { name: "Jupe Lou" }), {
      kind: "size_back",
      sizeLabel: "S",
      status: "digest",
      digestOn: D,
    });
    const { push, calls } = fakePush();

    expect(await sendDigest({ db: handle.db, push }, her.userId, evening, once)).toBe("sent");
    expect(calls[0]?.message).toEqual({
      title: "2 baisses de prix dans tes envies",
      body: "Jupe Lou : de retour en S chez Atelier Margaux",
      url: "/nouvelles",
    });
  });

  it("digest turned off: the drops stay in « Nouvelles », nothing is sent", async () => {
    const her = await person({ settings: { digest: false } });
    const id = await event(her, await wish(her), {
      kind: "price_drop",
      priceCents: 8000,
      previousCents: 10000,
      digestOn: D,
    });
    const { push, calls } = fakePush();

    expect(await sendDigest({ db: handle.db, push }, her.userId, evening, once)).toBe("skipped");
    expect(calls).toHaveLength(0);
    expect((await eventRow(id)).status).toBe("skipped");
  });

  it("drops on items no longer followed do not count", async () => {
    const her = await person();
    const kept = await wish(her);
    const ordered = await wish(her);
    await event(her, kept, { kind: "price_drop", priceCents: 8000, previousCents: 10000, digestOn: D });
    const gone = await event(her, ordered, { kind: "price_drop", priceCents: 8000, previousCents: 10000, digestOn: D });
    await handle.db.update(schema.items).set({ stage: "ordered" }).where(eq(schema.items.id, ordered.itemId));
    const { push, calls } = fakePush();

    await sendDigest({ db: handle.db, push }, her.userId, evening, once);
    expect(calls[0]?.message.title).toBe("1 baisse de prix dans tes envies");
    expect((await eventRow(gone)).status).toBe("skipped");
  });

  it("a busy push service: retried by pg-boss, the events wait", async () => {
    const her = await person();
    const id = await event(her, await wish(her), {
      kind: "price_drop",
      priceCents: 8000,
      previousCents: 10000,
      digestOn: D,
    });
    const { push } = fakePush(() => "retry");

    await expect(sendDigest({ db: handle.db, push }, her.userId, evening, once)).rejects.toBeInstanceOf(PushRetryError);
    expect(await eventRow(id)).toMatchObject({ status: "pending", sentAt: null });
    expect(
      await handle.db
        .select()
        .from(schema.alertSends)
        .where(and(eq(schema.alertSends.userId, her.userId), eq(schema.alertSends.ok, false))),
    ).toHaveLength(1);
  });

  it("a digest job that dies between the claim and the status is not sent again", async () => {
    const her = await person();
    const id = await event(her, await wish(her), {
      kind: "price_drop",
      priceCents: 8000,
      previousCents: 10000,
      digestOn: D,
    });
    const crashing: PushSender = async () => {
      throw new Error("worker killed");
    };
    await expect(sendDigest({ db: handle.db, push: crashing }, her.userId, evening, once)).rejects.toThrow(
      "worker killed",
    );
    expect((await eventRow(id)).sentAt?.toISOString()).toBe(evening.toISOString());

    const { push, calls } = fakePush();
    expect(await sendDigest({ db: handle.db, push }, her.userId, paris(D, "18:01"), once)).toBe("sent");
    expect(calls).toHaveLength(0);
    expect((await eventRow(id)).status).toBe("sent");
  });

  it("one push topic per person and day", async () => {
    const her = await person();
    await event(her, await wish(her), { kind: "price_drop", priceCents: 8000, previousCents: 10000, digestOn: D });
    const { push, calls } = fakePush();
    await sendDigest({ db: handle.db, push }, her.userId, evening, once);
    expect(calls[0]?.topic).toBe(digestTopic(her.userId, D));
    expect(digestTopic(her.userId, D)).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(digestTopic(her.userId, NEXT)).not.toBe(digestTopic(her.userId, D));
  });

  it("without push (no VAPID keys) or without devices: skipped", async () => {
    const her = await person();
    const id = await event(her, await wish(her), {
      kind: "price_drop",
      priceCents: 8000,
      previousCents: 10000,
      digestOn: D,
    });
    expect(await sendDigest({ db: handle.db, push: null }, her.userId, evening, once)).toBe("skipped");
    expect((await eventRow(id)).status).toBe("skipped");
  });
});
