import { and, type Database, eq, inArray, isNull, lte, orderAwaitingNews, schema, sql } from "@closyria/db";
import {
  ALERT_TIME_ZONE,
  alertItemHref,
  bareItemHref,
  DEFAULT_ALERT_SETTINGS,
  IMMEDIATE_ALERT_KINDS,
  nextSendAt,
  orderHref,
  parisDay,
  parisDaysBetween,
  RETURN_REMINDER_DAYS,
  UNCAPPED_ALERT_KINDS,
} from "@closyria/shared";
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
/**
 * At most this many stock and price notifications per person and Paris day; the next ones go to the digest. Order and
 * parcel kinds are outside the cap.
 */
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

/** « Commande reçue de {boutique} », « Commande reçue » when the shop is unknown. */
export function orderReceivedTitle(shop: string | null): string {
  const name = shop?.trim();
  return name ? `Commande reçue de ${cut(name)}` : "Commande reçue";
}

/** The parcel notifications' kinds (« Après la commande », Task 5). */
export type ParcelAlertKind = "parcel_out_for_delivery" | "parcel_pickup_ready" | "parcel_delivered";

const PARCEL_WORDS: Record<ParcelAlertKind, { step: string; body: string; status: string }> = {
  parcel_out_for_delivery: {
    step: "est en cours de livraison",
    body: "Il arrive aujourd'hui.",
    status: "out_for_delivery",
  },
  parcel_pickup_ready: {
    step: "est disponible en point relais",
    body: "Tu peux aller le chercher.",
    status: "pickup_ready",
  },
  parcel_delivered: { step: "est arrivé", body: "Ses articles sont dans « Reçu ».", status: "delivered" },
};

/** « Ton colis {boutique} est arrivé » (« … est disponible en point relais », « … est en cours de livraison »), « Ton colis est arrivé » without a shop. */
export function parcelTitle(kind: ParcelAlertKind, shop: string | null): string {
  const name = shop?.trim();
  return `Ton colis ${name ? `${cut(name)} ` : ""}${PARCEL_WORDS[kind].step}`;
}

const isParcelKind = (kind: string): kind is ParcelAlertKind => kind in PARCEL_WORDS;

/**
 * A delivery's body: « Ses articles sont dans « Reçu ». » only when that delivery moved them; else « Encore {n} colis
 * en route. » while some of the order's parcels are on their way; else nothing.
 */
export function parcelDeliveredBody(itemsReceived: boolean | null, parcelsLeft: number | null): string {
  if (itemsReceived) return PARCEL_WORDS.parcel_delivered.body;
  if (parcelsLeft && parcelsLeft > 0) return `Encore ${parcelsLeft} colis en route.`;
  return "";
}

/**
 * « Plus que 3 jours pour retourner {article} » (« Plus que 2 jours… », « Plus qu'un jour… » when the reminder is
 * caught up late), « … retourner ton article » without a name.
 */
export function returnReminderTitle(name: string | null, daysLeft: number): string {
  const what = name?.trim() ? cut(name.trim()) : "ton article";
  return daysLeft === 1
    ? `Plus qu'un jour pour retourner ${what}`
    : `Plus que ${daysLeft} jours pour retourner ${what}`;
}

/** « Retour possible jusqu'au 18 novembre » (a Paris day, `YYYY-MM-DD`). */
export function returnDeadlineSentence(deadline: string): string {
  const date = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${deadline}T00:00:00Z`),
  );
  return `Retour possible jusqu'au ${date}`;
}

/** « Tu as reçu ta commande {boutique} ? », « Tu as reçu ta commande ? » when the shop is unknown. */
export function orderReceivedCheckTitle(shop: string | null): string {
  const name = shop?.trim();
  return name ? `Tu as reçu ta commande ${cut(name)} ?` : "Tu as reçu ta commande ?";
}

/** The item's sheet, in the item's profile. */
export const itemUrl = alertItemHref;

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

/** The kinds the daily cap applies to: stock and price alerts (order and parcel kinds are outside it). */
const CAPPED_KINDS = IMMEDIATE_KINDS.filter((kind) => !(UNCAPPED_ALERT_KINDS as readonly string[]).includes(kind));
const isCapped = (kind: string) => (CAPPED_KINDS as readonly string[]).includes(kind);

/**
 * Her capped notifications (stock and price) already sent on that Paris day (the ones sent in a digest do not count,
 * nor the order and parcel ones).
 */
async function sentToday(db: Database, userId: string, day: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.alertEvents)
    .where(
      and(
        eq(schema.alertEvents.userId, userId),
        eq(schema.alertEvents.status, "sent"),
        inArray(schema.alertEvents.kind, CAPPED_KINDS),
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
 * - `digest` when she already had 5 stock or price notifications this Paris day (the day of the send); order and
 *   parcel kinds (`UNCAPPED_ALERT_KINDS`) neither count nor wait for the digest, only for the quiet hours;
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
      orderId: schema.alertEvents.orderId,
      parcelId: schema.alertEvents.parcelId,
      sizeLabel: schema.alertEvents.sizeLabel,
      priceCents: schema.alertEvents.priceCents,
      itemId: schema.alertEvents.itemId,
      createdAt: schema.alertEvents.createdAt,
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
      parcelOutForDeliveryOn: schema.alertSettings.parcelOutForDelivery,
      itemsReceived: schema.alertEvents.itemsReceived,
      parcelsLeft: schema.alertEvents.parcelsLeft,
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
  if (event.kind === "order_received" && event.orderId) {
    // Only while it waits for her « C'est bon »: validated or dismissed since, nothing to tell.
    const [order] = await db
      .select({
        status: schema.orders.status,
        shopName: sql<string | null>`coalesce(${schema.shops.name}, ${schema.orders.shopName})`,
      })
      .from(schema.orders)
      .leftJoin(schema.shops, eq(schema.shops.id, schema.orders.shopId))
      .where(and(eq(schema.orders.id, event.orderId), eq(schema.orders.userId, event.userId)));
    if (order?.status === "draft") {
      message = {
        title: orderReceivedTitle(order.shopName),
        body: "Vérifie les articles, puis « C'est bon ».",
        url: orderHref(event.orderId),
      };
    }
  }
  if (isParcelKind(event.kind) && event.parcelId && event.orderId) {
    // Only while the step still holds (held overnight, a parcel « en cours de livraison » may be delivered since), and
    // « en cours de livraison » only while her setting is on.
    const words = PARCEL_WORDS[event.kind];
    const [parcel] = await db
      .select({
        status: schema.parcels.status,
        shopName: sql<string | null>`coalesce(${schema.shops.name}, ${schema.orders.shopName})`,
      })
      .from(schema.parcels)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.parcels.orderId))
      .leftJoin(schema.shops, eq(schema.shops.id, schema.orders.shopId))
      .where(
        and(
          eq(schema.parcels.id, event.parcelId),
          eq(schema.orders.id, event.orderId),
          eq(schema.orders.userId, event.userId),
        ),
      );
    const wanted =
      event.kind !== "parcel_out_for_delivery" ||
      (event.parcelOutForDeliveryOn ?? DEFAULT_ALERT_SETTINGS.parcelOutForDelivery);
    if (parcel?.status === words.status && wanted) {
      const body =
        event.kind === "parcel_delivered" ? parcelDeliveredBody(event.itemsReceived, event.parcelsLeft) : words.body;
      message = { title: parcelTitle(event.kind, parcel.shopName), body, url: orderHref(event.orderId) };
    }
  }
  if (event.kind === "return_reminder" && event.itemId) {
    // Only while it is still hers to send back: received (not returned, sold…), not in the trash, the deadline 1 to 3
    // days ahead (held overnight or capped, it may have come).
    const [item] = await db
      .select({
        stage: schema.items.stage,
        deletedAt: schema.items.deletedAt,
        returnDeadline: schema.items.returnDeadline,
        productId: schema.items.productId,
        profileId: schema.items.profileId,
      })
      .from(schema.items)
      .where(and(eq(schema.items.id, event.itemId), eq(schema.items.userId, event.userId)));
    const daysLeft = item?.returnDeadline ? parisDaysBetween(parisDay(now), item.returnDeadline) : 0;
    if (
      item &&
      item.stage === "owned" &&
      !item.deletedAt &&
      item.returnDeadline &&
      daysLeft >= 1 &&
      daysLeft <= RETURN_REMINDER_DAYS
    ) {
      message = {
        title: returnReminderTitle(event.name, daysLeft),
        body: returnDeadlineSentence(item.returnDeadline),
        // An article without a product has its own sheet.
        url: item.productId ? itemUrl(item.productId, item.profileId) : bareItemHref(event.itemId),
      };
    }
  }
  if (event.kind === "order_received_check" && event.orderId) {
    // Only while still without news and not answered since it was asked.
    const [order] = await db
      .select({
        shopName: sql<string | null>`coalesce(${schema.shops.name}, ${schema.orders.shopName})`,
        notYetAt: schema.orders.receivedNotYetAt,
        awaiting: sql<boolean>`${orderAwaitingNews()}`,
      })
      .from(schema.orders)
      .leftJoin(schema.shops, eq(schema.shops.id, schema.orders.shopId))
      .where(
        and(
          eq(schema.orders.id, event.orderId),
          eq(schema.orders.userId, event.userId),
          eq(schema.orders.status, "confirmed"),
        ),
      );
    if (order?.awaiting && (!order.notYetAt || order.notYetAt.getTime() < event.createdAt.getTime())) {
      message = {
        title: orderReceivedCheckTitle(order.shopName),
        body: "Réponds « Oui » ou « Pas encore ».",
        url: orderHref(event.orderId),
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
  if (isCapped(event.kind) && (await sentToday(db, event.userId, today)) >= DAILY_PUSH_CAP) {
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
