import { and, createDb, eq, findOrCreateShop, schema } from "@closyria/db";
import { nextSendAt, PARCEL_CHECK_SLOW_HOURS, type ParcelStatus } from "@closyria/shared";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { checkDueParcels, claimDueParcels, PARCEL_CHECK_QUEUE, parcelCheckHandler } from "./parcel-check";
import type { TrackedParcel, TrackingConnector, TrackingConnectors, TrackingResult } from "./tracking";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let handle: ReturnType<typeof createDb>;
let counter = 0;

beforeAll(async () => {
  database = await createTestDatabase();
  handle = createDb(database.url, { max: 8 });
}, 60_000);

afterAll(async () => {
  await handle?.pool.end();
  await database?.stop();
});

// Winter, 11:00 in Paris (UTC+1).
const now = new Date("2026-11-14T10:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A connector answering from a script, recording what it was asked. */
function scripted(answer: (parcel: TrackedParcel) => TrackingResult | Promise<TrackingResult>, name = "fake") {
  const asked: TrackedParcel[] = [];
  const connector: TrackingConnector = {
    name,
    async track(parcel) {
      asked.push(parcel);
      return answer(parcel);
    },
  };
  return { connector, asked };
}

const failing = (): TrackingConnector => ({
  name: "down",
  async track() {
    throw new Error("carrier down");
  },
});

const found = (status: ParcelStatus, extra: Partial<Extract<TrackingResult, { kind: "found" }>> = {}) =>
  ({ kind: "found", status, events: [], estimatedAt: null, deliveredAt: null, ...extra }) as TrackingResult;

async function person(settings?: { parcelOutForDelivery: boolean }) {
  const { db } = handle;
  const userId = `parcel-user-${++counter}`;
  await db.insert(schema.user).values({ id: userId, name: "Camille", email: `${userId}@exemple.test` });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ userId, name: "Moi", audience: "women", color: "plum" })
    .returning();
  if (settings) await db.insert(schema.alertSettings).values({ userId, ...settings });
  return { userId, profileId: profile?.id as string };
}
type Person = Awaited<ReturnType<typeof person>>;

async function shop(returnDays?: number) {
  const n = ++counter;
  const row = await findOrCreateShop(handle.db, `https://maison-lune-${n}.test/`);
  await handle.db
    .update(schema.shops)
    .set({ name: "Maison Lune", ...(returnDays !== undefined ? { returnDays } : {}) })
    .where(eq(schema.shops.id, row.id));
  return row.id;
}

async function item(who: Person, values: { stage?: string; product?: boolean; deleted?: boolean } = {}) {
  const { db } = handle;
  let productId: string | null = null;
  if (values.product !== false) {
    const shopRow = await findOrCreateShop(db, `https://catalogue-${++counter}.test/`);
    const [product] = await db
      .insert(schema.products)
      .values({ shopId: shopRow.id, canonicalUrl: `https://catalogue-${counter}.test/p`, name: "Robe Iris" })
      .returning();
    productId = product?.id as string;
  }
  const [row] = await db
    .insert(schema.items)
    .values({
      userId: who.userId,
      profileId: who.profileId,
      productId,
      nameOverride: productId ? null : "Pull Marin",
      stage: values.stage ?? "ordered",
      inOrderDraft: false,
      deletedAt: values.deleted ? new Date(now.getTime() - DAY) : null,
    })
    .returning();
  return row?.id as string;
}

async function order(
  who: Person,
  options: {
    status?: "draft" | "confirmed" | "dismissed";
    shopId?: string | null;
    itemIds?: string[];
    carrier?: string | null;
    parcelStatus?: ParcelStatus;
    nextCheckAt?: Date | null;
    checkUntil?: Date;
    checkFailures?: number;
  } = {},
) {
  const { db } = handle;
  const [row] = await db
    .insert(schema.orders)
    .values({
      userId: who.userId,
      profileId: who.profileId,
      shopId: options.shopId ?? null,
      status: options.status ?? "confirmed",
      source: "email",
      parseMethod: "known",
    })
    .returning();
  const orderId = row?.id as string;
  for (const [position, itemId] of (options.itemIds ?? []).entries()) {
    await db.insert(schema.orderLines).values({ orderId, itemId, name: `Article ${position}`, position });
  }
  const [parcel] = await db
    .insert(schema.parcels)
    .values({
      orderId,
      carrier: options.carrier === undefined ? "mondial_relay" : options.carrier,
      trackingNumber: `${10_000_000 + ++counter}`,
      status: options.parcelStatus ?? "pending",
      nextCheckAt: options.nextCheckAt === undefined ? new Date(now.getTime() - HOUR) : options.nextCheckAt,
      checkUntil: options.checkUntil ?? new Date(now.getTime() + 20 * DAY),
      checkFailures: options.checkFailures ?? 0,
    })
    .returning();
  return { orderId, parcelId: parcel?.id as string, trackingNumber: parcel?.trackingNumber as string };
}

async function addParcel(orderId: string, values: { status?: ParcelStatus; checkUntil?: Date } = {}) {
  const [row] = await handle.db
    .insert(schema.parcels)
    .values({
      orderId,
      carrier: "gls",
      trackingNumber: `${20_000_000 + ++counter}`,
      status: values.status ?? "in_transit",
      nextCheckAt: new Date(now.getTime() - HOUR),
      checkUntil: values.checkUntil ?? new Date(now.getTime() + 20 * DAY),
    })
    .returning();
  return row?.id as string;
}

const parcelRow = async (id: string) =>
  (await handle.db.select().from(schema.parcels).where(eq(schema.parcels.id, id)))[0];
const itemRow = async (id: string) => (await handle.db.select().from(schema.items).where(eq(schema.items.id, id)))[0];
const stageEvents = (itemId: string) =>
  handle.db
    .select()
    .from(schema.itemEvents)
    .where(and(eq(schema.itemEvents.itemId, itemId), eq(schema.itemEvents.type, "stage")));
const alertsOf = (userId: string) =>
  handle.db.select().from(schema.alertEvents).where(eq(schema.alertEvents.userId, userId));

/** Only the parcels of `only` are checked (each test's own), whatever other tests left due. */
function connectorsFor(connector: TrackingConnector | null, laPoste: TrackingConnector | null = null) {
  return { aggregator: connector, laPoste } satisfies TrackingConnectors;
}

/** Runs the check on one parcel only: claims due parcels and puts the others back as they were. */
async function checkOnly(parcelId: string, connectors: TrackingConnectors, at = now) {
  return checkDueParcels({ db: handle.db, connectors }, at, { onlyParcelIds: [parcelId] });
}

describe("parcel-check: delivery", () => {
  it("moves her ordered items to « Reçu » with the return deadline, notifies once, and stops the tracking", async () => {
    const who = await person();
    const shopId = await shop(10);
    const withProduct = await item(who);
    const productless = await item(who, { product: false });
    const { parcelId, orderId } = await order(who, { shopId, itemIds: [withProduct, productless] });
    const deliveredAt = new Date("2026-11-13T22:30:00Z"); // 23:30 in Paris, the 13th
    const { connector } = scripted(() =>
      found("delivered", {
        deliveredAt,
        events: [
          { at: deliveredAt, status: "delivered", label: "Colis livré" },
          { at: new Date("2026-11-12T08:00:00Z"), status: "in_transit", label: "En cours d'acheminement" },
        ],
      }),
    );

    const first = await checkOnly(parcelId, connectorsFor(connector));
    expect(first).toEqual({ checked: 1, delivered: 1 });

    const parcel = await parcelRow(parcelId);
    expect(parcel).toMatchObject({ status: "delivered", nextCheckAt: null, checkFailures: 0 });
    expect(parcel?.deliveredAt?.toISOString()).toBe(deliveredAt.toISOString());
    expect(parcel?.lastEventAt?.toISOString()).toBe(deliveredAt.toISOString());

    for (const id of [withProduct, productless]) {
      const row = await itemRow(id);
      // Paris day of the delivery (the 13th) + 10 days.
      expect(row).toMatchObject({ stage: "owned", returnDeadline: "2026-11-23", inOrderDraft: false });
      const events = await stageEvents(id);
      expect(events.map((e) => [e.stage, e.at.toISOString(), e.spentCents])).toEqual([
        ["owned", deliveredAt.toISOString(), null],
      ]);
    }

    const alerts = await alertsOf(who.userId);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: "parcel_delivered",
      parcelId,
      orderId,
      shopId,
      profileId: who.profileId,
      status: "pending",
      itemsReceived: true,
      parcelsLeft: 0,
    });
    expect(alerts[0]?.sendAfter?.toISOString()).toBe(nextSendAt(now).toISOString());

    const events = await handle.db.select().from(schema.parcelEvents).where(eq(schema.parcelEvents.parcelId, parcelId));
    expect(events).toHaveLength(2);
  });

  it("is idempotent: a delivery read twice moves nothing twice and notifies once", async () => {
    const who = await person();
    const itemId = await item(who);
    const { parcelId } = await order(who, { itemIds: [itemId] });
    const deliveredAt = new Date("2026-11-13T09:00:00Z");
    const answer = () =>
      found("delivered", { deliveredAt, events: [{ at: deliveredAt, status: "delivered", label: "Livré" }] });
    const { connector } = scripted(answer);
    await checkOnly(parcelId, connectorsFor(connector));
    // Read again (a crashed run, a re-scheduled check): nothing new.
    await handle.db.update(schema.parcels).set({ nextCheckAt: now }).where(eq(schema.parcels.id, parcelId));
    await checkOnly(parcelId, connectorsFor(connector));
    // And the delivery applied a second time on a parcel still claimed as not delivered.
    await handle.db
      .update(schema.parcels)
      .set({ status: "in_transit", nextCheckAt: now })
      .where(eq(schema.parcels.id, parcelId));
    await checkOnly(parcelId, connectorsFor(connector));

    expect(await stageEvents(itemId)).toHaveLength(1);
    expect((await alertsOf(who.userId)).filter((a) => a.kind === "parcel_delivered")).toHaveLength(1);
    expect(
      await handle.db.select().from(schema.parcelEvents).where(eq(schema.parcelEvents.parcelId, parcelId)),
    ).toHaveLength(1);
  });

  it("uses 14 days without a shop, leaves alone what is no longer ordered or in the trash", async () => {
    const who = await person();
    const ordered = await item(who);
    const sold = await item(who, { stage: "sold" });
    const trashed = await item(who, { deleted: true });
    const { parcelId } = await order(who, { shopId: null, itemIds: [ordered, sold, trashed] });
    const deliveredAt = new Date("2026-11-13T09:00:00Z");
    const { connector } = scripted(() => found("delivered", { deliveredAt }));
    await checkOnly(parcelId, connectorsFor(connector));
    expect(await itemRow(ordered)).toMatchObject({ stage: "owned", returnDeadline: "2026-11-27" });
    expect(await itemRow(sold)).toMatchObject({ stage: "sold", returnDeadline: null });
    expect(await itemRow(trashed)).toMatchObject({ stage: "ordered", returnDeadline: null });
    expect(await alertsOf(who.userId)).toHaveLength(1);
  });

  it("a delivery dated in the future (a carrier's clock) counts as now", async () => {
    const who = await person();
    const itemId = await item(who);
    const { parcelId } = await order(who, { itemIds: [itemId] });
    const { connector } = scripted(() => found("delivered", { deliveredAt: new Date(now.getTime() + 3 * DAY) }));
    await checkOnly(parcelId, connectorsFor(connector));
    expect((await parcelRow(parcelId))?.deliveredAt?.toISOString()).toBe(now.toISOString());
    expect((await stageEvents(itemId))[0]?.at.toISOString()).toBe(now.toISOString());
  });
});

describe("parcel-check: an order in several parcels", () => {
  const delivered = (at: Date) => found("delivered", { deliveredAt: at });
  const due = (id: string) =>
    handle.db.update(schema.parcels).set({ nextCheckAt: now }).where(eq(schema.parcels.id, id));

  it("the first parcel delivered moves nothing; the last moves everything, the deadline from the last", async () => {
    const who = await person();
    const shopId = await shop(10);
    const items = [await item(who), await item(who, { product: false })];
    const { orderId, parcelId: first } = await order(who, { shopId, itemIds: items });
    const second = await addParcel(orderId);

    await checkOnly(first, connectorsFor(scripted(() => delivered(new Date("2026-11-12T10:00:00Z"))).connector));
    for (const id of items) expect(await itemRow(id)).toMatchObject({ stage: "ordered", returnDeadline: null });
    expect((await alertsOf(who.userId)).map((a) => [a.parcelId, a.itemsReceived, a.parcelsLeft])).toEqual([
      [first, false, 1],
    ]);

    const last = new Date("2026-11-13T22:30:00Z"); // the 13th, 23:30 in Paris
    await checkOnly(second, connectorsFor(scripted(() => delivered(last)).connector));
    for (const id of items) {
      expect(await itemRow(id)).toMatchObject({ stage: "owned", returnDeadline: "2026-11-23" });
      expect((await stageEvents(id)).map((e) => e.at.toISOString())).toEqual([last.toISOString()]);
    }
    const alerts = await alertsOf(who.userId);
    expect(alerts.find((a) => a.parcelId === second)).toMatchObject({ itemsReceived: true, parcelsLeft: 0 });
    expect(alerts).toHaveLength(2);

    // Processed again, both: nothing moves twice, nothing notified twice.
    for (const id of [first, second]) {
      await handle.db
        .update(schema.parcels)
        .set({ status: "in_transit", nextCheckAt: now })
        .where(eq(schema.parcels.id, id));
      await checkOnly(id, connectorsFor(scripted(() => delivered(last)).connector));
    }
    for (const id of items) expect(await stageEvents(id)).toHaveLength(1);
    expect(await alertsOf(who.userId)).toHaveLength(2);
  });

  it("one delivered and one turning unknown: everything moves when the late one gives up", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const who = await person();
    const itemId = await item(who);
    const returned = await item(who, { stage: "returned" });
    const { orderId, parcelId: first } = await order(who, { itemIds: [itemId, returned] });
    const late = await addParcel(orderId, { status: "in_transit" });
    await checkOnly(first, connectorsFor(scripted(() => delivered(new Date("2026-11-13T09:00:00Z"))).connector));
    expect((await itemRow(itemId))?.stage).toBe("ordered");

    for (let i = 1; i <= 3; i++) {
      await due(late);
      await checkOnly(late, connectorsFor(failing()));
      expect((await itemRow(itemId))?.stage).toBe(i < 3 ? "ordered" : "owned");
    }
    expect(await parcelRow(late)).toMatchObject({ status: "unknown" });
    // From the delivered one (the 13th, Paris) + 14 days; a returned item is left alone.
    expect(await itemRow(itemId)).toMatchObject({ returnDeadline: "2026-11-27" });
    expect(await itemRow(returned)).toMatchObject({ stage: "returned", returnDeadline: null });
    warn.mockRestore();
  });

  it("a late parcel at the end of its tracking settles the order too", async () => {
    const who = await person();
    const itemId = await item(who);
    const { orderId, parcelId: first } = await order(who, { itemIds: [itemId] });
    const late = await addParcel(orderId, { checkUntil: new Date(now.getTime() + HOUR) });
    await checkOnly(first, connectorsFor(scripted(() => delivered(new Date("2026-11-13T09:00:00Z"))).connector));
    expect((await itemRow(itemId))?.stage).toBe("ordered");
    await due(late);
    await checkOnly(late, connectorsFor(scripted(() => found("in_transit")).connector), new Date(now.getTime() + HOUR));
    expect((await itemRow(itemId))?.stage).toBe("owned");
  });

  it("a delivered parcel checked again settles the order once the other one is unknown", async () => {
    const who = await person();
    const itemId = await item(who);
    const { orderId, parcelId: first } = await order(who, { itemIds: [itemId] });
    const late = await addParcel(orderId);
    await checkOnly(first, connectorsFor(scripted(() => delivered(new Date("2026-11-13T09:00:00Z"))).connector));
    await handle.db.update(schema.parcels).set({ status: "unknown" }).where(eq(schema.parcels.id, late));
    await due(first);
    const { connector, asked } = scripted(() => found("in_transit"));
    await checkOnly(first, connectorsFor(connector));
    expect((await itemRow(itemId))?.stage).toBe("owned");
    expect(await parcelRow(first)).toMatchObject({ status: "delivered", nextCheckAt: null });
    expect(asked).toHaveLength(1);
  });

  it("nothing delivered: nothing moves, even when every parcel is settled (the J+10 question takes over)", async () => {
    const who = await person();
    const itemId = await item(who);
    const { parcelId } = await order(who, { itemIds: [itemId], checkFailures: 2 });
    await checkOnly(parcelId, connectorsFor(scripted(() => ({ kind: "not_found" })).connector));
    expect(await parcelRow(parcelId)).toMatchObject({ status: "unknown" });
    expect((await itemRow(itemId))?.stage).toBe("ordered");
    expect(await alertsOf(who.userId)).toHaveLength(0);
  });
});

describe("parcel-check: steps and notifications", () => {
  it("stores the steps once, the status, the estimate, and the next check at the step's rhythm", async () => {
    const who = await person();
    const { parcelId } = await order(who);
    const estimatedAt = new Date("2026-11-16T12:00:00Z");
    const events = [
      { at: new Date("2026-11-13T08:00:00Z"), status: "in_transit" as const, label: "Pris en charge" },
      { at: new Date("2026-11-13T20:00:00Z"), status: "in_transit" as const, label: "En cours d'acheminement" },
    ];
    const { connector } = scripted(() => found("in_transit", { events, estimatedAt }));
    await checkOnly(parcelId, connectorsFor(connector));
    await handle.db.update(schema.parcels).set({ nextCheckAt: now }).where(eq(schema.parcels.id, parcelId));
    await checkOnly(parcelId, connectorsFor(connector));
    const parcel = await parcelRow(parcelId);
    expect(parcel?.status).toBe("in_transit");
    expect(parcel?.estimatedAt?.toISOString()).toBe(estimatedAt.toISOString());
    expect(parcel?.lastEventAt?.toISOString()).toBe("2026-11-13T20:00:00.000Z");
    expect(parcel?.nextCheckAt?.toISOString()).toBe(
      new Date(now.getTime() + PARCEL_CHECK_SLOW_HOURS * HOUR).toISOString(),
    );
    const stored = await handle.db.select().from(schema.parcelEvents).where(eq(schema.parcelEvents.parcelId, parcelId));
    expect(stored).toHaveLength(2);
    expect(await alertsOf(who.userId)).toHaveLength(0);
  });

  it("a pickup point notifies once; out for delivery only when her setting is on", async () => {
    const off = await person();
    const on = await person({ parcelOutForDelivery: true });
    const shopId = await shop();
    const a = await order(off, { shopId });
    const b = await order(on, { shopId });
    const { connector } = scripted(() => found("out_for_delivery"));
    await checkOnly(a.parcelId, connectorsFor(connector));
    await checkOnly(b.parcelId, connectorsFor(connector));
    expect(await alertsOf(off.userId)).toHaveLength(0);
    expect((await alertsOf(on.userId)).map((e) => [e.kind, e.parcelId])).toEqual([
      ["parcel_out_for_delivery", b.parcelId],
    ]);
    expect((await parcelRow(a.parcelId))?.nextCheckAt?.toISOString()).toBe(
      new Date(now.getTime() + 2 * HOUR).toISOString(),
    );

    const pickup = scripted(() => found("pickup_ready"));
    for (let i = 0; i < 2; i++) {
      await handle.db.update(schema.parcels).set({ nextCheckAt: now }).where(eq(schema.parcels.id, a.parcelId));
      await checkOnly(a.parcelId, connectorsFor(pickup.connector));
    }
    expect((await alertsOf(off.userId)).map((e) => e.kind)).toEqual(["parcel_pickup_ready"]);
  });
});

describe("parcel-check: failures stay silent (RF 4)", () => {
  it("three failures in a row turn the parcel unknown, still checked; an answer resets the count", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const who = await person();
    const { parcelId } = await order(who, { parcelStatus: "in_transit" });
    for (let i = 1; i <= 3; i++) {
      await handle.db.update(schema.parcels).set({ nextCheckAt: now }).where(eq(schema.parcels.id, parcelId));
      const result = await checkOnly(parcelId, connectorsFor(failing()));
      expect(result).toEqual({ checked: 1, delivered: 0 });
      const parcel = await parcelRow(parcelId);
      expect(parcel?.checkFailures).toBe(i);
      expect(parcel?.status).toBe(i < 3 ? "in_transit" : "unknown");
      expect(parcel?.nextCheckAt?.toISOString()).toBe(new Date(now.getTime() + 6 * HOUR).toISOString());
    }
    await handle.db.update(schema.parcels).set({ nextCheckAt: now }).where(eq(schema.parcels.id, parcelId));
    await checkOnly(parcelId, connectorsFor(scripted(() => found("in_transit")).connector));
    expect(await parcelRow(parcelId)).toMatchObject({ status: "in_transit", checkFailures: 0 });
    expect(await alertsOf(who.userId)).toHaveLength(0);
    // Logged by the connector's name and the error's, never a number or a key.
    expect(warn.mock.calls).toEqual(Array(3).fill(["parcel-check: check failed (down: Error)"]));
    warn.mockRestore();
  });

  it("a number the carrier does not know counts as a miss; registered and waiting does not", async () => {
    const who = await person();
    const { parcelId } = await order(who, { checkFailures: 2 });
    await checkOnly(parcelId, connectorsFor(scripted(() => ({ kind: "waiting" })).connector));
    expect(await parcelRow(parcelId)).toMatchObject({ status: "pending", checkFailures: 0 });
    await handle.db
      .update(schema.parcels)
      .set({ nextCheckAt: now, checkFailures: 2 })
      .where(eq(schema.parcels.id, parcelId));
    await checkOnly(parcelId, connectorsFor(scripted(() => ({ kind: "not_found" })).connector));
    expect(await parcelRow(parcelId)).toMatchObject({ status: "unknown", checkFailures: 3 });
  });

  it("without the connector's key the parcel waits (checked later); without a carrier it is unknown, no longer checked", async () => {
    const who = await person();
    const noKey = await order(who, { carrier: "colissimo" });
    const noCarrier = await order(who, { carrier: null });
    const { connector, asked } = scripted(() => found("delivered"));
    await checkOnly(noKey.parcelId, connectorsFor(connector, null));
    await checkOnly(noCarrier.parcelId, connectorsFor(connector, connector));
    expect(asked).toHaveLength(0);
    expect(await parcelRow(noKey.parcelId)).toMatchObject({ status: "pending", checkFailures: 0 });
    expect((await parcelRow(noKey.parcelId))?.nextCheckAt?.toISOString()).toBe(
      new Date(now.getTime() + 6 * HOUR).toISOString(),
    );
    expect(await parcelRow(noCarrier.parcelId)).toMatchObject({
      status: "unknown",
      checkFailures: 0,
      nextCheckAt: null,
    });
  });

  it("La Poste's carriers go to La Poste, the others to the aggregator", async () => {
    const who = await person();
    const colissimo = await order(who, { carrier: "chronopost" });
    const gls = await order(who, { carrier: "gls" });
    const laPoste = scripted(() => found("in_transit"), "laposte");
    const aggregator = scripted(() => found("in_transit"), "aggregator");
    const connectors = connectorsFor(aggregator.connector, laPoste.connector);
    await checkOnly(colissimo.parcelId, connectors);
    await checkOnly(gls.parcelId, connectors);
    expect(laPoste.asked).toEqual([{ carrier: "chronopost", trackingNumber: colissimo.trackingNumber }]);
    expect(aggregator.asked).toEqual([{ carrier: "gls", trackingNumber: gls.trackingNumber }]);
  });
});

describe("parcel-check: which parcels", () => {
  it("only due parcels of validated orders; the tracking stops at check_until", async () => {
    const who = await person();
    const draft = await order(who, { status: "draft" });
    const dismissed = await order(who, { status: "dismissed" });
    const later = await order(who, { nextCheckAt: new Date(now.getTime() + HOUR) });
    const stopped = await order(who, { nextCheckAt: null });
    const ending = await order(who, { checkUntil: new Date(now.getTime() + HOUR) });
    const due = await order(who);

    const claimed = await claimDueParcels(handle.db, now, 500, [
      draft.parcelId,
      dismissed.parcelId,
      later.parcelId,
      stopped.parcelId,
      ending.parcelId,
      due.parcelId,
    ]);
    expect(claimed.map((p) => p.id).sort()).toEqual([ending.parcelId, due.parcelId].sort());
    // Claimed: not claimed again by an overlapping run until its check is done (or its lease runs out).
    expect(
      await claimDueParcels(handle.db, now, 500, [ending.parcelId, due.parcelId]).then((rows) => rows.length),
    ).toBe(0);

    await handle.db.update(schema.parcels).set({ nextCheckAt: now }).where(eq(schema.parcels.id, ending.parcelId));
    await checkOnly(ending.parcelId, connectorsFor(scripted(() => found("in_transit")).connector));
    // The last check is at check_until, then none.
    expect((await parcelRow(ending.parcelId))?.nextCheckAt?.toISOString()).toBe(
      new Date(now.getTime() + HOUR).toISOString(),
    );
    await checkOnly(
      ending.parcelId,
      connectorsFor(scripted(() => found("in_transit")).connector),
      new Date(now.getTime() + HOUR),
    );
    expect((await parcelRow(ending.parcelId))?.nextCheckAt).toBeNull();
  });

  it("a parcel whose number changed during the check keeps the new one, checked again soon", async () => {
    const who = await person();
    const itemId = await item(who);
    const { parcelId } = await order(who, { itemIds: [itemId] });
    const { connector } = scripted(async () => {
      await handle.db.update(schema.parcels).set({ carrier: "dpd" }).where(eq(schema.parcels.id, parcelId));
      return found("delivered", { deliveredAt: now });
    });
    await checkOnly(parcelId, connectorsFor(connector));
    expect(await parcelRow(parcelId)).toMatchObject({ status: "pending", carrier: "dpd" });
    expect((await parcelRow(parcelId))?.nextCheckAt?.toISOString()).toBe(
      new Date(now.getTime() + 60_000).toISOString(),
    );
    expect((await itemRow(itemId))?.stage).toBe("ordered");
  });
});

describe("parcel-check: concurrent sweeps", () => {
  it("never claims a parcel twice", async () => {
    const who = await person();
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push((await order(who)).parcelId);
    const claims = await Promise.all(Array.from({ length: 4 }, () => claimDueParcels(handle.db, now, 8, ids)));
    const claimed = claims.flat().map((p) => p.id);
    expect(new Set(claimed).size).toBe(claimed.length);
    expect(claimed.sort()).toEqual([...ids].sort());
  });

  it("one parcel that cannot be updated does not stop the sweep", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const who = await person();
    const a = await order(who);
    const b = await order(who);
    // The first answer is unreadable by the database (an event label too long for its check).
    let calls = 0;
    const { connector } = scripted(() =>
      ++calls === 1
        ? found("in_transit", { events: [{ at: now, status: "in_transit", label: "x".repeat(500) }] })
        : found("in_transit"),
    );
    const result = await checkDueParcels({ db: handle.db, connectors: connectorsFor(connector) }, now, {
      onlyParcelIds: [a.parcelId, b.parcelId],
    });
    expect(result.checked).toBe(2);
    expect(error.mock.calls).toEqual([["parcel-check: parcel not updated (Error)"]]);
    const statuses = [(await parcelRow(a.parcelId))?.status, (await parcelRow(b.parcelId))?.status].sort();
    expect(statuses).toEqual(["in_transit", "pending"]);
    error.mockRestore();
  });
});

describe("parcel-check queue", () => {
  it("is named parcel-check and fails a job with data", async () => {
    expect(PARCEL_CHECK_QUEUE).toBe("parcel-check");
    const runs: number[] = [];
    const handler = parcelCheckHandler(async () => {
      runs.push(1);
      return { checked: 0, delivered: 0 };
    });
    await handler([{ id: "a", data: {} }]);
    expect(runs).toHaveLength(1);
    await expect(handler([{ id: "b", data: { parcelId: "x" } }])).rejects.toThrow(/invalid job data/);
  });
});
