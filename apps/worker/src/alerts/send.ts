import { and, type Database, eq, inArray, isNull, lte, schema, sql } from "@closyria/db";
import { ALERT_TIME_ZONE, DEFAULT_ALERT_SETTINGS, IMMEDIATE_ALERT_KINDS, nextSendAt, parisDay } from "@closyria/shared";
import { z } from "zod";
import { followedItem } from "./detect";
import { deliver, type PushMessage, PushRetryError, type PushSender } from "./push";

/** One job per immediate alert (« taille revenue », « prix visé »), keyed by the event. */
export const ALERT_SEND_QUEUE = "alert-send";
/** The minute sweep that queues the immediate alerts now due. */
export const ALERT_SEND_PLAN_QUEUE = "alert-send-plan";
/** One job per event at a time (queued, waiting for a retry or running); 429/5xx: 3 more tries. */
export const ALERT_SEND_QUEUE_OPTIONS = {
  policy: "exclusive",
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
} as const;
/** At most this many immediate notifications per person and Paris day; the next ones go to the digest. */
export const DAILY_PUSH_CAP = 5;
/** Events queued per sweep (the oldest due first); the rest wait for the next minute. */
const SWEEP_BUDGET = 500;
/** An item's or shop's name longer than this is cut in a notification. */
const MAX_NAME = 80;

export const IMMEDIATE_KINDS = IMMEDIATE_ALERT_KINDS;

export type SendDeps = { db: Database; push: PushSender | null };
export type Attempt = { lastAttempt: boolean };
export type AlertQueue = {
  send(name: string, data: object, options: { singletonKey: string; startAfter?: Date }): Promise<unknown>;
};

const cut = (text: string) => (text.length > MAX_NAME ? `${text.slice(0, MAX_NAME - 1).trimEnd()}…` : text);

/** The item's name exactly as stored (cut when very long), or « Ton article » without one. */
function itemName(name: string | null): string {
  const trimmed = name?.trim();
  return trimmed ? cut(trimmed) : "Ton article";
}

/** « 59 € », « 59,90 € » (fr-FR, cents only when there are some). */
export function formatAlertPrice(cents: number, currency: string | null): string {
  const digits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: currency ?? "EUR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100);
}

/**
 * « {Nom} : de retour en {taille} chez {boutique} », « {Nom} : de retour en {taille} » without a shop, « {Nom} : de
 * retour en stock chez {boutique} » without a size (« any »).
 */
export function sizeBackSentence(name: string | null, size: string | null, shop: string | null): string {
  const where = shop ? ` chez ${cut(shop)}` : "";
  return `${itemName(name)} : de retour en ${size ?? "stock"}${where}`;
}

/** « {Nom} : {prix} (tu visais {seuil}) ». */
export function targetPriceSentence(name: string | null, cents: number, target: number, currency: string | null) {
  return `${itemName(name)} : ${formatAlertPrice(cents, currency)} (tu visais ${formatAlertPrice(target, currency)})`;
}

/** The item's sheet, in the item's profile. */
export const itemUrl = (productId: string, profileId: string) => `/produits/${productId}?profil=${profileId}`;

/**
 * The minute sweep: queues every immediate alert still `pending` whose `send_after` (8:00 Paris for one born at night)
 * has come (`alert_events_pending_send_idx`). An event already queued, waiting for a retry or running is not queued twice (`exclusive` + its id as
 * key). Returns how many jobs were asked for.
 */
export async function planAlertSends(db: Database, queue: AlertQueue, now: Date): Promise<number> {
  const due = await db
    .select({ id: schema.alertEvents.id, sendAfter: schema.alertEvents.sendAfter })
    .from(schema.alertEvents)
    .where(
      and(
        eq(schema.alertEvents.status, "pending"),
        inArray(schema.alertEvents.kind, IMMEDIATE_KINDS),
        // A claimed one (`sent_at` set, still pending: its job died) comes back too, to be closed as sent.
        lte(schema.alertEvents.sendAfter, now),
      ),
    )
    .orderBy(schema.alertEvents.sendAfter)
    .limit(SWEEP_BUDGET);
  for (const event of due) {
    await queue.send(
      ALERT_SEND_QUEUE,
      { eventId: event.id },
      { singletonKey: event.id, ...(event.sendAfter ? { startAfter: event.sendAfter } : {}) },
    );
  }
  return due.length;
}

const setStatus = (db: Database, id: string, values: Partial<typeof schema.alertEvents.$inferInsert>) =>
  db
    .update(schema.alertEvents)
    .set(values)
    .where(and(eq(schema.alertEvents.id, id), eq(schema.alertEvents.status, "pending")));

/** Her immediate notifications already sent on that Paris day (the ones sent in a digest do not count). */
async function sentToday(db: Database, userId: string, day: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.alertEvents)
    .where(
      and(
        eq(schema.alertEvents.userId, userId),
        eq(schema.alertEvents.status, "sent"),
        inArray(schema.alertEvents.kind, IMMEDIATE_KINDS),
        isNull(schema.alertEvents.digestOn),
        sql`(${schema.alertEvents.sentAt} at time zone ${ALERT_TIME_ZONE})::date = ${day}::date`,
      ),
    );
  return row?.n ?? 0;
}

/**
 * Sends one immediate alert, applying the rules at send time:
 * - `held` in the quiet hours (22:00–8:00 Paris): its `send_after` moves to 8:00, the sweep queues it again then;
 * - `skipped` (kept for « Nouvelles », never pushed) when the item is no longer followed, her setting for the kind is
 *   off, the target price no longer holds, push is off (no VAPID keys), she is a guest or has no device;
 * - `digest` when she already had 5 immediate notifications this Paris day (the day of the send);
 * - `sent` when a device accepted it. A busy push service (429/5xx) throws `PushRetryError` for pg-boss to try again,
 *   until the last attempt (then `skipped`).
 * `none` when the event is not a pending immediate alert (already handled, or gone).
 *
 * At most once: the event is claimed (`sent_at`) before the push and marked `sent` after it. A job that dies in
 * between leaves it claimed; the next job closes it as `sent` without pushing again (a lost notification rather than
 * a duplicate). A retry releases the claim. The push `topic` (the event id) also makes the push service replace,
 * not repeat, a message it already holds.
 */
export async function sendAlert(
  deps: SendDeps,
  eventId: string,
  now: Date,
  attempt: Attempt,
): Promise<"sent" | "digest" | "skipped" | "held" | "none"> {
  const { db, push } = deps;
  const [event] = await db
    .select({
      id: schema.alertEvents.id,
      userId: schema.alertEvents.userId,
      kind: schema.alertEvents.kind,
      // The item's profile now (it may have moved since the event): the link opens it there.
      profileId: schema.items.profileId,
      productId: schema.alertEvents.productId,
      sizeLabel: schema.alertEvents.sizeLabel,
      priceCents: schema.alertEvents.priceCents,
      sendAfter: schema.alertEvents.sendAfter,
      sentAt: schema.alertEvents.sentAt,
      followed: sql<boolean>`coalesce((${followedItem}), false)`,
      name: sql<string | null>`coalesce(${schema.items.nameOverride}, ${schema.products.name})`,
      currency: schema.products.currency,
      shopName: schema.shops.name,
      targetPriceCents: schema.items.targetPriceCents,
      isAnonymous: schema.user.isAnonymous,
      sizeBackOn: schema.alertSettings.sizeBack,
      targetPriceOn: schema.alertSettings.targetPrice,
    })
    .from(schema.alertEvents)
    .innerJoin(schema.user, eq(schema.user.id, schema.alertEvents.userId))
    .leftJoin(schema.items, eq(schema.items.id, schema.alertEvents.itemId))
    .leftJoin(schema.products, eq(schema.products.id, schema.alertEvents.productId))
    .leftJoin(schema.shops, eq(schema.shops.id, schema.products.shopId))
    .leftJoin(schema.alertSettings, eq(schema.alertSettings.userId, schema.alertEvents.userId))
    .where(
      and(
        eq(schema.alertEvents.id, eventId),
        eq(schema.alertEvents.status, "pending"),
        inArray(schema.alertEvents.kind, IMMEDIATE_KINDS),
      ),
    );
  if (!event) return "none";
  if (event.sentAt) {
    // Claimed by a job that died after the claim: it may have gone out, never push it twice.
    await setStatus(db, event.id, { status: "sent" });
    return "sent";
  }

  const allowed = nextSendAt(now);
  if (allowed.getTime() > now.getTime() || (event.sendAfter && event.sendAfter.getTime() > now.getTime())) {
    const later = event.sendAfter && event.sendAfter > allowed ? event.sendAfter : allowed;
    await setStatus(db, event.id, { sendAfter: later });
    return "held";
  }

  const skip = async () => {
    await setStatus(db, event.id, { status: "skipped" });
    return "skipped" as const;
  };

  let message: PushMessage | null = null;
  if (event.followed && event.productId && event.profileId) {
    const url = itemUrl(event.productId, event.profileId);
    if (event.kind === "size_back" && (event.sizeBackOn ?? DEFAULT_ALERT_SETTINGS.sizeBack)) {
      message = {
        title: "Ta taille est revenue",
        body: sizeBackSentence(event.name, event.sizeLabel, event.shopName),
        url,
      };
    } else if (
      event.kind === "target_price" &&
      (event.targetPriceOn ?? DEFAULT_ALERT_SETTINGS.targetPrice) &&
      event.priceCents !== null &&
      event.targetPriceCents !== null &&
      event.priceCents <= event.targetPriceCents
    ) {
      message = {
        title: "Prix visé",
        body: targetPriceSentence(event.name, event.priceCents, event.targetPriceCents, event.currency),
        url,
      };
    }
  }
  if (!message || !push || event.isAnonymous === true) return skip();

  const [devices] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.userId, event.userId));
  if (!devices || devices.n === 0) return skip();

  const today = parisDay(now);
  if ((await sentToday(db, event.userId, today)) >= DAILY_PUSH_CAP) {
    await setStatus(db, event.id, { status: "digest", digestOn: today });
    return "digest";
  }

  const [claimed] = await db
    .update(schema.alertEvents)
    .set({ sentAt: now })
    .where(
      and(
        eq(schema.alertEvents.id, event.id),
        eq(schema.alertEvents.status, "pending"),
        isNull(schema.alertEvents.sentAt),
      ),
    )
    .returning({ id: schema.alertEvents.id });
  if (!claimed) return "none";

  const result = await deliver(db, push, event.userId, message, { topic: event.id.replaceAll("-", "") }, now);
  if (result.delivered > 0) {
    await setStatus(db, event.id, { status: "sent" });
    return "sent";
  }
  if (result.retry && !attempt.lastAttempt) {
    await setStatus(db, event.id, { sentAt: null });
    throw new PushRetryError();
  }
  await setStatus(db, event.id, { status: "skipped", sentAt: null });
  return "skipped";
}

const sendJobSchema = z.object({ eventId: z.uuid() });

/** A pg-boss job with its metadata (`includeMetadata: true`): the retry count tells the last attempt. */
export type MetadataJob = { id: string; data: unknown; retryCount?: number; retryLimit?: number };

/** Without metadata, the attempt counts as the last one: an event is never left pending by a failed job. */
export const isLastAttempt = (job: MetadataJob) =>
  job.retryCount === undefined || job.retryLimit === undefined || job.retryCount >= job.retryLimit;

/** alert-send: `{ eventId }`; anything else fails the job. */
export function alertSendHandler(deps: SendDeps, clock: () => Date = () => new Date()) {
  return async (jobs: MetadataJob[]): Promise<void> => {
    for (const job of jobs) {
      const parsed = sendJobSchema.safeParse(job.data);
      if (!parsed.success) {
        console.error(`${ALERT_SEND_QUEUE}: invalid job data (job ${job.id}), failing it`);
        throw new Error(`invalid job data on ${ALERT_SEND_QUEUE}`);
      }
      await sendAlert(deps, parsed.data.eventId, clock(), { lastAttempt: isLastAttempt(job) });
    }
  };
}
