import { createHash } from "node:crypto";
import { and, type Database, eq, inArray, isNotNull, isNull, lte, schema, sql } from "@closyria/db";
import {
  ALERT_TIME_ZONE,
  DEFAULT_ALERT_SETTINGS,
  DIGEST_WAITING_STATUSES,
  nextSendAt,
  parisDay,
  parisHour,
} from "@closyria/shared";
import { z } from "zod";
import { followedItem } from "./detect";
import { deliver, type PushMessage, PushRetryError } from "./push";
import { type Attempt, isLastAttempt, type MetadataJob, type SendDeps, sizeBackSentence } from "./send";

/** One job per person whose digest is due, keyed by her id. */
export const ALERT_DIGEST_QUEUE = "alert-digest";
/** Every 15 minutes: the people whose digest hour (Paris) has come. */
export const ALERT_DIGEST_PLAN_QUEUE = "alert-digest-plan";
/** One digest per person at a time; 429/5xx: 3 more tries. */
export const ALERT_DIGEST_QUEUE_OPTIONS = {
  policy: "exclusive",
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
} as const;
/** Lines past this are left to « Nouvelles » (a notification stays short). */
const MAX_DIGEST_LINES = 5;
/** People queued per planning pass. */
const PLAN_BUDGET = 1000;

const WAITING = DIGEST_WAITING_STATUSES;

type DigestQueue = { send(name: string, data: object, options: { singletonKey: string }): Promise<unknown> };

/** `YYYY-MM-DD` plus `days`. */
function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
}

/** « aujourd’hui », « demain », or the weekday (« mercredi »). */
function dayWord(startsOn: string, today: string): string {
  if (startsOn === today) return "aujourd’hui";
  if (startsOn === addDays(today, 1)) return "demain";
  return new Intl.DateTimeFormat("fr-FR", { weekday: "long", timeZone: "UTC" }).format(new Date(startsOn));
}

/** A digest's facts, worded by `digestMessage`. */
export type DigestFacts = {
  /** Price drops, plus the target prices the daily cap sent to the digest. */
  drops: number;
  sizeBacks: { name: string | null; size: string | null; shop: string | null }[];
  /** First days of the sales announced. */
  sales: string[];
  promoShops: string[];
};

/**
 * « {n} baisses de prix dans tes envies », then the sizes back the cap held, « Les soldes commencent {jour} » and
 * « {boutique} est en promo »: the first line is the title, the next ones the body. Null when there is nothing to say.
 */
export function digestMessage(facts: DigestFacts, today: string): PushMessage | null {
  const lines: string[] = [];
  if (facts.drops > 0) {
    lines.push(`${facts.drops} ${facts.drops > 1 ? "baisses" : "baisse"} de prix dans tes envies`);
  }
  for (const s of facts.sizeBacks) lines.push(sizeBackSentence(s.name, s.size, s.shop));
  for (const startsOn of [...new Set(facts.sales)].sort()) {
    lines.push(`Les soldes commencent ${dayWord(startsOn, today)}`);
  }
  for (const shop of [...new Set(facts.promoShops)]) lines.push(`${shop} est en promo`);
  // Lines past the 5th are not shown; their events are still marked sent with the digest, and stay in « Nouvelles ».
  const [title, ...body] = lines.slice(0, MAX_DIGEST_LINES);
  if (!title) return null;
  return { title, body: body.join("\n"), url: "/nouvelles" };
}

/**
 * Every 15 minutes: queues the digest of each person whose digest hour (Paris, 18:00 by default) is the current one,
 * who has events waiting for a digest of today or before, and who had no digest yet today. Nothing in the quiet hours.
 * Returns how many people were queued.
 */
export async function planDigests(db: Database, queue: DigestQueue, now: Date): Promise<number> {
  if (nextSendAt(now).getTime() > now.getTime()) return 0;
  const today = parisDay(now);
  const hour = parisHour(now);
  const e = schema.alertEvents;
  const people = await db
    .selectDistinct({ userId: e.userId })
    .from(e)
    .leftJoin(schema.alertSettings, eq(schema.alertSettings.userId, e.userId))
    .where(
      and(
        isNotNull(e.digestOn),
        lte(e.digestOn, today),
        inArray(e.status, WAITING),
        sql`coalesce(${schema.alertSettings.digestHour}, ${DEFAULT_ALERT_SETTINGS.digestHour}) = ${hour}`,
        sql`not exists (select 1 from ${e} d where d.user_id = ${e.userId} and d.digest_on is not null
          and d.status = 'sent' and (d.sent_at at time zone ${ALERT_TIME_ZONE})::date = ${today}::date)`,
      ),
    )
    .limit(PLAN_BUDGET);
  for (const person of people) {
    await queue.send(ALERT_DIGEST_QUEUE, { userId: person.userId }, { singletonKey: person.userId });
  }
  return people.length;
}

/**
 * Sends her digest: one notification for her events waiting for a digest (of today or before, not yet sent).
 * - `skipped` for all of them when her digest is off (they stay in « Nouvelles »), push is off (no VAPID keys), she is
 *   a guest or has no device; item events whose item is no longer followed and sales already started are skipped;
 * - `sent` when a device accepted it (each event then marked sent: it never enters another digest);
 * - a busy push service (429/5xx) throws `PushRetryError` for pg-boss, the events waiting, until the last attempt.
 * `held` in the quiet hours, `none` when nothing waits.
 */
export async function sendDigest(
  deps: SendDeps,
  userId: string,
  now: Date,
  attempt: Attempt,
): Promise<"sent" | "skipped" | "held" | "none"> {
  const { db, push } = deps;
  if (nextSendAt(now).getTime() > now.getTime()) return "held";
  const today = parisDay(now);
  const e = schema.alertEvents;
  const waiting = and(eq(e.userId, userId), isNotNull(e.digestOn), lte(e.digestOn, today), inArray(e.status, WAITING));

  // Claimed by a digest job that died after the claim: they may have gone out, never push them twice.
  const recovered = await db
    .update(e)
    .set({ status: "sent" })
    .where(and(waiting, isNotNull(e.sentAt)))
    .returning({ id: e.id });
  if (recovered.length > 0) return "sent";

  const events = await db
    .select({
      id: e.id,
      kind: e.kind,
      sizeLabel: e.sizeLabel,
      shopId: e.shopId,
      salePeriodId: e.salePeriodId,
      itemId: e.itemId,
      followed: sql<boolean>`coalesce((${followedItem}), false)`,
      name: sql<string | null>`coalesce(${schema.items.nameOverride}, ${schema.products.name})`,
      itemShop: schema.shops.name,
    })
    .from(e)
    .leftJoin(schema.items, eq(schema.items.id, e.itemId))
    .leftJoin(schema.products, eq(schema.products.id, e.productId))
    .leftJoin(schema.shops, eq(schema.shops.id, schema.products.shopId))
    .where(waiting)
    .orderBy(e.createdAt);
  if (events.length === 0) return "none";

  const mark = async (ids: string[], values: Partial<typeof schema.alertEvents.$inferInsert>) => {
    if (ids.length > 0)
      await db
        .update(e)
        .set(values)
        .where(and(inArray(e.id, ids), inArray(e.status, WAITING)));
  };
  const allIds = events.map((ev) => ev.id);

  const [who] = await db
    .select({ isAnonymous: schema.user.isAnonymous, digest: schema.alertSettings.digest })
    .from(schema.user)
    .leftJoin(schema.alertSettings, eq(schema.alertSettings.userId, schema.user.id))
    .where(eq(schema.user.id, userId));
  if (!who || !push || who.isAnonymous === true || !(who.digest ?? DEFAULT_ALERT_SETTINGS.digest)) {
    await mark(allIds, { status: "skipped" });
    return "skipped";
  }

  const promoIds = events.flatMap((ev) => (ev.kind === "shop_promo" && ev.shopId ? [ev.shopId] : []));
  const periodIds = events.flatMap((ev) => (ev.kind === "sale_period" && ev.salePeriodId ? [ev.salePeriodId] : []));
  const promoShops = new Map(
    promoIds.length === 0
      ? []
      : (
          await db
            .select({ id: schema.shops.id, name: schema.shops.name })
            .from(schema.shops)
            .where(inArray(schema.shops.id, promoIds))
        ).map((s) => [s.id, s.name] as const),
  );
  const periods = new Map(
    periodIds.length === 0
      ? []
      : (
          await db
            .select({ id: schema.salePeriods.id, startsOn: schema.salePeriods.startsOn })
            .from(schema.salePeriods)
            .where(inArray(schema.salePeriods.id, periodIds))
        ).map((p) => [p.id, p.startsOn] as const),
  );

  const facts: DigestFacts = { drops: 0, sizeBacks: [], sales: [], promoShops: [] };
  const used: string[] = [];
  for (const ev of events) {
    if (ev.kind === "price_drop" || ev.kind === "target_price") {
      if (!ev.followed) continue;
      facts.drops += 1;
    } else if (ev.kind === "size_back") {
      if (!ev.followed) continue;
      facts.sizeBacks.push({ name: ev.name, size: ev.sizeLabel, shop: ev.itemShop });
    } else if (ev.kind === "sale_period") {
      const startsOn = ev.salePeriodId ? periods.get(ev.salePeriodId) : undefined;
      // Sales already under way: nothing to announce any more.
      if (!startsOn || startsOn < today) continue;
      facts.sales.push(startsOn);
    } else if (ev.kind === "shop_promo") {
      const shop = ev.shopId ? promoShops.get(ev.shopId) : undefined;
      if (!shop) continue;
      facts.promoShops.push(shop);
    } else {
      continue;
    }
    used.push(ev.id);
  }
  const unused = allIds.filter((id) => !used.includes(id));
  const message = digestMessage(facts, today);
  if (!message) {
    await mark(allIds, { status: "skipped" });
    return "skipped";
  }

  // At most once, as for the immediate alerts: claim (`sent_at`), push, then mark sent; a retry releases the claim.
  const claimed = (
    await db
      .update(e)
      .set({ sentAt: now })
      .where(and(inArray(e.id, used), inArray(e.status, WAITING), isNull(e.sentAt)))
      .returning({ id: e.id })
  ).map((row) => row.id);
  if (claimed.length === 0) return "none";

  const result = await deliver(db, push, userId, message, { topic: digestTopic(userId, today) }, now);
  if (result.delivered > 0) {
    await mark(claimed, { status: "sent" });
    await mark(unused, { status: "skipped" });
    return "sent";
  }
  if (result.retry && !attempt.lastAttempt) {
    await mark(claimed, { sentAt: null });
    throw new PushRetryError();
  }
  await mark(allIds, { status: "skipped", sentAt: null });
  return "skipped";
}

/** One push topic per person and Paris day (32 base64url characters): a repeated digest replaces the first one. */
export function digestTopic(userId: string, day: string): string {
  return createHash("sha256").update(`digest:${userId}:${day}`).digest("base64url").slice(0, 32);
}

const digestJobSchema = z.object({ userId: z.string().min(1) });

/** alert-digest: `{ userId }`; anything else fails the job. */
export function digestHandler(deps: SendDeps, clock: () => Date = () => new Date()) {
  return async (jobs: MetadataJob[]): Promise<void> => {
    for (const job of jobs) {
      const parsed = digestJobSchema.safeParse(job.data);
      if (!parsed.success) {
        console.error(`${ALERT_DIGEST_QUEUE}: invalid job data (job ${job.id}), failing it`);
        throw new Error(`invalid job data on ${ALERT_DIGEST_QUEUE}`);
      }
      await sendDigest(deps, parsed.data.userId, clock(), { lastAttempt: isLastAttempt(job) });
    }
  };
}
