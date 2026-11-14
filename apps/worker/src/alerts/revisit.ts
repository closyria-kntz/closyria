import {
  and,
  type Database,
  eq,
  importCoversShop,
  inArray,
  isNull,
  readShopifySlowdown,
  schema,
  shopLastCaptureBlocked,
  shopRevisitExcluded,
  sql,
} from "@closyria/db";
import { CAPTURE_QUEUES, captureJobSchema } from "@closyria/shared";
import { followedItem } from "./detect";

/** A followed product of a shop the import does not read is checked again this long after its last check. */
export const REVISIT_INTERVAL_MS = 6 * 60 * 60_000;
/** Revisits queued per pass (every 15 min): at most 240 an hour, one at a time. */
export const REVISIT_BUDGET = 60;
/** A shop that blocks us (403, robots.txt) still gets one polite revisit this often: a refusal blocks it again. */
export const BLOCKED_SHOP_RETRY_MS = 7 * 24 * 60 * 60_000;

export type RevisitQueue = { send(queue: string, data: object): Promise<unknown> };

/**
 * Queues a `revisit` capture for the followed products (someone's « Repéré » wish with « M'alerter » on) of shops the
 * hourly import does not read (`importCoversShop`) and that are not entered by hand, refused or merged
 * (`shopRevisitExcluded`), checked over 6 h ago and not revisited within 6 h (a failed revisit waits too), with no
 * capture under way: at most `REVISIT_BUDGET`, the longest unchecked first, products never read last (often a link
 * that never worked). While Shopify asks for the nightly rhythm, no Shopify product is revisited. A product that left
 * the shop (404/410) is not. Returns how many were queued.
 *
 * A shop whose last telling capture was blocked or disallowed by robots.txt (`shopLastCaptureBlocked`) gets one try a
 * week: its first followed product in that order, when no revisit of the shop was made in 7 days. robots.txt is read
 * first as for any capture; a refusal keeps it blocked for another week, a success lifts the block.
 *
 * Each goes through `runCapture` like any capture (robots.txt, address policy, spacing, Shopify line at the monitors'
 * low place) and writes like a sheet's refresh: a history point only on a change, which is what creates the alerts.
 */
export async function planRevisits(db: Database, queue: RevisitQueue, at = new Date()): Promise<number> {
  const slowdown = await readShopifySlowdown(db, at);
  const since = new Date(at.getTime() - REVISIT_INTERVAL_MS).toISOString();
  const retrySince = new Date(at.getTime() - BLOCKED_SHOP_RETRY_MS).toISOString();
  const p = schema.products;
  const s = schema.shops;
  const order = sql`${p.lastCapturedAt} is null, ${p.lastCapturedAt} asc, ${p.id}`;
  const due = await db
    .select({ id: p.id, shopId: p.shopId, url: p.canonicalUrl })
    .from(p)
    .innerJoin(s, eq(s.id, p.shopId))
    .where(
      and(
        isNull(p.removedAt),
        sql`exists (${db
          .select({ one: sql`1` })
          .from(schema.items)
          .where(and(eq(schema.items.productId, p.id), followedItem))})`,
        sql`not ${importCoversShop}`,
        sql`not ${shopRevisitExcluded}`,
        sql`(not ${shopLastCaptureBlocked} or (
          not exists (select 1 from captures c where c.shop_id = ${s.id} and c.trigger = 'revisit'
            and c.created_at >= ${retrySince}::timestamptz)
          and ${p.id} = (select p2.id from products p2 where p2.shop_id = ${s.id} and p2.removed_at is null
            and exists (select 1 from items where items.product_id = p2.id and ${followedItem})
            order by p2.last_captured_at is null, p2.last_captured_at asc, p2.id limit 1)))`,
        slowdown?.level === "nightly" ? sql`${s.platform} <> 'shopify'` : undefined,
        sql`(${p.lastCapturedAt} is null or ${p.lastCapturedAt} < ${since}::timestamptz)`,
        sql`not exists (select 1 from captures c where c.product_id = ${p.id}
          and (c.status in ('queued', 'running') or (c.trigger = 'revisit' and c.created_at >= ${since}::timestamptz)))`,
      ),
    )
    .orderBy(order)
    .limit(REVISIT_BUDGET);

  let queued = 0;
  for (const product of due) {
    const capture = await db.transaction(async (tx) => {
      // One capture at a time per product, whoever asks (the API takes the same lock for a pasted link).
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${product.id}, 0))`);
      const [active] = await tx
        .select({ id: schema.captures.id })
        .from(schema.captures)
        .where(and(eq(schema.captures.productId, product.id), inArray(schema.captures.status, ["queued", "running"])))
        .limit(1);
      if (active) return null;
      const [row] = await tx
        .insert(schema.captures)
        .values({
          shopId: product.shopId,
          productId: product.id,
          url: product.url,
          trigger: "revisit",
          status: "queued",
          // The plan's clock: « not revisited within 6 h » reads it.
          createdAt: at,
        })
        .returning({ id: schema.captures.id });
      return row ?? null;
    });
    if (!capture) continue;
    try {
      await queue.send(CAPTURE_QUEUES.revisit, { captureId: capture.id });
      queued += 1;
    } catch (error) {
      console.error(`revisit: cannot queue capture ${capture.id}`, error);
      await db
        .update(schema.captures)
        .set({ status: "failed", errorCode: "queue_unavailable", finishedAt: new Date() })
        .where(eq(schema.captures.id, capture.id));
    }
  }
  return queued;
}

type JobLike = { id?: string; data: unknown };

/**
 * capture-revisit: no data or `{}` (the 15-minute schedule) plans the revisits; `{ captureId }` runs that capture
 * (`run`, i.e. `runCapture`); anything else fails the job.
 */
export function revisitHandler(db: Database, queue: RevisitQueue, run: (captureId: string) => Promise<void>) {
  return async (jobs: JobLike[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data;
      const empty =
        data === null ||
        data === undefined ||
        (typeof data === "object" && !Array.isArray(data) && Object.keys(data).length === 0);
      if (empty) {
        const planned = await planRevisits(db, queue);
        if (planned > 0) console.log(`revisit: ${planned} followed product(s) queued`);
        continue;
      }
      const parsed = captureJobSchema.safeParse(data);
      if (!parsed.success) {
        console.error(`${CAPTURE_QUEUES.revisit}: invalid job data (job ${job.id ?? "?"}), failing it`);
        throw new Error(`invalid job data on ${CAPTURE_QUEUES.revisit}`);
      }
      await run(parsed.data.captureId);
    }
  };
}
