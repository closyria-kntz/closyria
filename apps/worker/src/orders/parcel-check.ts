import { and, asc, type Database, eq, inArray, isNotNull, lte, receiveOrderItems, schema, sql } from "@closyria/db";
import {
  type Carrier,
  carrierSchema,
  DEFAULT_ALERT_SETTINGS,
  nextParcelCheckClamped,
  nextSendAt,
  PARCEL_MAX_CHECK_FAILURES,
  type ParcelStatus,
  parcelStatusSchema,
} from "@closyria/shared";
import { connectorFor, type TrackingConnectors, TrackingError, type TrackingResult } from "./tracking";

/**
 * « Après la commande », Task 5: the parcels of her validated orders are asked to their carrier when due
 * (`next_check_at`, every 2 or 6 hours by step), until delivered or `check_until` (30 days). Once every parcel of an
 * order is settled and one at least delivered, her ordered items move to « Reçu » with their return deadline; a pickup point, a delivery (and out for delivery when she
 * wants it) are notified once per parcel through the alerts' sending (quiet hours, daily cap). A carrier that does not
 * answer, or does not know the number, three times in a row turns the parcel `unknown`, silently (RF 4).
 *
 * Lock order (as « C'est bon » and the e-mail reading): her profiles (`profiles:{user}` advisory lock), the order row,
 * the parcel row, then the item rows. The carrier is asked outside any transaction.
 */

/** The 15-minute sweep. */
export const PARCEL_CHECK_QUEUE = "parcel-check";
/** Parcels claimed per transaction, and checked per sweep at most (the rest wait for the next one). */
const CLAIM_BATCH = 50;
const SWEEP_BUDGET = 500;
/** A parcel corrected during its check is asked again this much later (the next sweep, not this one). */
const RECHECK_MS = 60_000;
/** A claimed parcel is not claimed again for this long (a run that died gives it back after it). */
export const PARCEL_CLAIM_LEASE_MS = 30 * 60_000;

export type ParcelCheckDeps = { db: Database; connectors: TrackingConnectors };
export type ClaimedParcel = { id: string; carrier: Carrier | null; trackingNumber: string };

/** What a check gave: the carrier's answer, a failure (thrown), or no way to ask (no key, no carrier). */
type Outcome = { kind: "answer"; result: TrackingResult } | { kind: "failed" } | { kind: "skipped" };

/**
 * Claims up to `limit` due parcels of validated orders (oldest due first), skipping the ones another run holds, and
 * pushes their `next_check_at` past the lease. `onlyIds` restricts the claim (tests).
 */
export async function claimDueParcels(
  db: Database,
  now: Date,
  limit: number,
  onlyIds?: string[],
): Promise<ClaimedParcel[]> {
  return db.transaction(async (tx) => {
    const p = schema.parcels;
    const rows = await tx
      .select({ id: p.id, carrier: p.carrier, trackingNumber: p.trackingNumber })
      .from(p)
      .innerJoin(schema.orders, eq(schema.orders.id, p.orderId))
      .where(
        and(
          isNotNull(p.nextCheckAt),
          lte(p.nextCheckAt, now),
          eq(schema.orders.status, "confirmed"),
          ...(onlyIds ? [inArray(p.id, onlyIds)] : []),
        ),
      )
      .orderBy(asc(p.nextCheckAt))
      .limit(limit)
      .for("update", { of: p, skipLocked: true });
    if (rows.length === 0) return [];
    await tx
      .update(p)
      .set({ nextCheckAt: new Date(now.getTime() + PARCEL_CLAIM_LEASE_MS) })
      .where(
        inArray(
          p.id,
          rows.map((r) => r.id),
        ),
      );
    return rows.map((r) => ({ ...r, carrier: carrierSchema.safeParse(r.carrier).data ?? null }));
  });
}

/** Asks the parcel's carrier; never throws (a failure is an outcome, logged without the number or a key). */
async function askCarrier(connectors: TrackingConnectors, parcel: ClaimedParcel): Promise<Outcome> {
  const connector = connectorFor(parcel.carrier, connectors);
  if (!connector || !parcel.carrier) return { kind: "skipped" };
  try {
    return {
      kind: "answer",
      result: await connector.track({ carrier: parcel.carrier, trackingNumber: parcel.trackingNumber }),
    };
  } catch (error) {
    // A TrackingError's message holds neither a key nor a number; anything else only by its name.
    const reason =
      error instanceof TrackingError
        ? error.message
        : `${connector.name}: ${error instanceof Error ? error.name : "error"}`;
    console.warn(`${PARCEL_CHECK_QUEUE}: check failed (${reason})`);
    return { kind: "failed" };
  }
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const NOTIFIED: Partial<Record<ParcelStatus, "parcel_out_for_delivery" | "parcel_pickup_ready" | "parcel_delivered">> =
  {
    out_for_delivery: "parcel_out_for_delivery",
    pickup_ready: "parcel_pickup_ready",
    delivered: "parcel_delivered",
  };

/**
 * Applies a check to the parcel, in one transaction, then settles its order (`settleOrder`). Returns whether it was
 * delivered by this check. A parcel already delivered or gone is left as it is; one whose carrier or number changed
 * during the check (a correction) keeps it, checked again at the next sweep; one without a carrier is no longer
 * checked (nothing to ask).
 */
async function applyOutcome(db: Database, claimed: ClaimedParcel, outcome: Outcome, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ userId: schema.orders.userId })
      .from(schema.parcels)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.parcels.orderId))
      .where(eq(schema.parcels.id, claimed.id));
    if (!owner) return false;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`profiles:${owner.userId}`}, 0))`);
    const [order] = await tx
      .select({
        id: schema.orders.id,
        userId: schema.orders.userId,
        profileId: schema.orders.profileId,
        shopId: schema.orders.shopId,
      })
      .from(schema.orders)
      .innerJoin(schema.parcels, eq(schema.parcels.orderId, schema.orders.id))
      .where(eq(schema.parcels.id, claimed.id))
      .for("update", { of: schema.orders });
    if (!order) return false;
    const [parcel] = await tx.select().from(schema.parcels).where(eq(schema.parcels.id, claimed.id)).for("update");
    if (!parcel) return false;
    if (parcel.status === "delivered") {
      await tx.update(schema.parcels).set({ nextCheckAt: null }).where(eq(schema.parcels.id, parcel.id));
      await settleOrder(tx, order, now);
      return false;
    }
    if (parcel.carrier !== claimed.carrier || parcel.trackingNumber !== claimed.trackingNumber) {
      const soon = new Date(now.getTime() + RECHECK_MS);
      await tx.update(schema.parcels).set({ nextCheckAt: soon }).where(eq(schema.parcels.id, parcel.id));
      return false;
    }

    let status: ParcelStatus = parcelStatusSchema.parse(parcel.status);
    let failures = parcel.checkFailures;
    const values: Partial<typeof schema.parcels.$inferInsert> = {};
    if (outcome.kind === "answer" && outcome.result.kind === "found") {
      const { result } = outcome;
      status = result.status;
      failures = 0;
      if (result.events.length > 0) {
        await tx
          .insert(schema.parcelEvents)
          .values(result.events.map((e) => ({ parcelId: parcel.id, at: e.at, status: e.status, label: e.label })))
          .onConflictDoNothing();
        const latest = Math.max(...result.events.map((e) => e.at.getTime()));
        if (!parcel.lastEventAt || latest > parcel.lastEventAt.getTime()) values.lastEventAt = new Date(latest);
      }
      values.estimatedAt = result.estimatedAt;
      if (status === "delivered") {
        // A carrier's clock ahead of ours: the delivery cannot be later than now.
        const at = result.deliveredAt && result.deliveredAt.getTime() < now.getTime() ? result.deliveredAt : now;
        values.deliveredAt = at;
      }
    } else if (outcome.kind === "answer" && outcome.result.kind === "waiting") {
      failures = 0;
    } else if (outcome.kind === "failed" || (outcome.kind === "answer" && outcome.result.kind === "not_found")) {
      failures += 1;
      if (failures >= PARCEL_MAX_CHECK_FAILURES) status = "unknown";
    }
    // No carrier (an e-mail's number of unknown format): nobody to ask, `unknown` as when she pastes one.
    if (!claimed.carrier) status = "unknown";

    await tx
      .update(schema.parcels)
      .set({
        ...values,
        status,
        checkFailures: failures,
        // Without a carrier there is nobody to ask: no more checks (a correction sets its next check).
        nextCheckAt: claimed.carrier ? nextParcelCheckClamped(status, now, parcel.checkUntil) : null,
      })
      .where(eq(schema.parcels.id, parcel.id));

    // Settled once delivered, unknown or at the end of its tracking: the order may now be received.
    const settled = await settleOrder(tx, order, now);

    const kind = NOTIFIED[status];
    if (kind && outcome.kind === "answer") {
      let wanted = true;
      if (kind === "parcel_out_for_delivery") {
        const [settings] = await tx
          .select({ on: schema.alertSettings.parcelOutForDelivery })
          .from(schema.alertSettings)
          .where(eq(schema.alertSettings.userId, order.userId));
        wanted = settings?.on ?? DEFAULT_ALERT_SETTINGS.parcelOutForDelivery;
      }
      if (wanted) {
        // Once per parcel and kind (`alert_events_parcel_kind_idx`). A delivery keeps what it brought: its items
        // moved to « Reçu », or how many of the order's parcels are still on their way.
        await tx
          .insert(schema.alertEvents)
          .values({
            userId: order.userId,
            profileId: order.profileId,
            kind,
            orderId: order.id,
            parcelId: parcel.id,
            shopId: order.shopId,
            sendAfter: nextSendAt(now),
            ...(kind === "parcel_delivered"
              ? { itemsReceived: settled.moved > 0, parcelsLeft: settled.inTransit }
              : {}),
          })
          .onConflictDoNothing();
      }
    }
    return status === "delivered";
  });
}

/** A parcel done with: delivered, `unknown` (the carrier gave up on it, or we did), or at the end of its tracking. */
const isSettled = (parcel: { status: string; checkUntil: Date }, now: Date) =>
  parcel.status === "delivered" || parcel.status === "unknown" || parcel.checkUntil.getTime() <= now.getTime();

/**
 * Receives the order once all its parcels are settled and one at least was delivered (none delivered: the J+10
 * question of Task 6 takes over): her items move to « Reçu » on the latest delivery's date (`receiveOrderItems`, shared
 * with her « Oui » to that question), with their return deadline counted from it. Run after every check of one of its parcels (under the order's lock), so a late parcel
 * turning `unknown` or reaching its end never blocks the others; idempotent.
 *
 * Returns how many items moved and how many of its parcels are still on their way.
 */
async function settleOrder(
  tx: Tx,
  order: { id: string; userId: string; shopId: string | null },
  now: Date,
): Promise<{ moved: number; inTransit: number }> {
  const parcels = await tx
    .select({
      status: schema.parcels.status,
      checkUntil: schema.parcels.checkUntil,
      deliveredAt: schema.parcels.deliveredAt,
    })
    .from(schema.parcels)
    .where(eq(schema.parcels.orderId, order.id));
  const inTransit = parcels.filter((p) => !isSettled(p, now)).length;
  const deliveries = parcels.flatMap((p) =>
    p.status === "delivered" && p.deliveredAt ? [p.deliveredAt.getTime()] : [],
  );
  if (inTransit > 0 || deliveries.length === 0) return { moved: 0, inTransit };
  const deliveredAt = new Date(Math.max(...deliveries));
  const moved = await receiveOrderItems(tx, order, deliveredAt, now);
  return { moved, inTransit };
}

/**
 * One sweep: claims the due parcels by batches, asks each carrier and applies the answer, up to SWEEP_BUDGET parcels.
 * `onlyParcelIds` restricts it (tests).
 */
export async function checkDueParcels(
  deps: ParcelCheckDeps,
  now: Date,
  options: { onlyParcelIds?: string[] } = {},
): Promise<{ checked: number; delivered: number }> {
  let checked = 0;
  let delivered = 0;
  while (checked < SWEEP_BUDGET) {
    const batch = await claimDueParcels(
      deps.db,
      now,
      Math.min(CLAIM_BATCH, SWEEP_BUDGET - checked),
      options.onlyParcelIds,
    );
    if (batch.length === 0) break;
    for (const parcel of batch) {
      const outcome = await askCarrier(deps.connectors, parcel);
      try {
        if (await applyOutcome(deps.db, parcel, outcome, now)) delivered += 1;
      } catch (error) {
        // One parcel's failure (a deadlock, the database busy) does not stop the sweep: it keeps its lease and comes
        // back after it.
        console.error(`${PARCEL_CHECK_QUEUE}: parcel not updated (${error instanceof Error ? error.name : "error"})`);
      }
      checked += 1;
    }
  }
  return { checked, delivered };
}

type JobLike = { id?: string; data: unknown };

/** parcel-check: the schedule sends no data; anything else fails the job. */
export function parcelCheckHandler(run: () => Promise<{ checked: number; delivered: number }>) {
  return async (jobs: JobLike[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data;
      const empty =
        data === null ||
        data === undefined ||
        (typeof data === "object" && !Array.isArray(data) && Object.keys(data).length === 0);
      if (!empty) {
        console.error(`${PARCEL_CHECK_QUEUE}: invalid job data (job ${job.id ?? "?"}), failing it`);
        throw new Error(`invalid job data on ${PARCEL_CHECK_QUEUE}`);
      }
      const { checked, delivered } = await run();
      if (checked > 0) console.log(`parcels: ${checked} checked, ${delivered} delivered`);
    }
  };
}
