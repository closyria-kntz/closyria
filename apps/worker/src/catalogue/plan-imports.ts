import { and, type Database, eq, importNotUnderWay, isNull, readShopifySlowdown, schema, sql } from "@closyria/db";
import {
  CATALOGUE_IMPORT_INTERVAL_MS,
  CATALOGUE_IMPORT_LARGE_INTERVAL_MS,
  CATALOGUE_IMPORT_LARGE_SHOP,
  CATALOGUE_IMPORT_QUEUE,
  type ShopifySlowdownLevel,
} from "@closyria/shared";

export type ImportQueue = {
  send(queue: string, data: object, options: { singletonKey: string }): Promise<unknown>;
};

/**
 * The planner runs every 15 minutes, so an import that started a few minutes after its tick (the worker took it a
 * little later) is still due on the tick an interval later, instead of waiting one more tick.
 */
export const PLAN_GRACE_MS = 5 * 60_000;
/** Once a night when Shopify asks us to slow down twice (« nightly »): from 03:00, Paris time. */
const NIGHTLY_HOUR = 3;
const DAY_MS = 24 * 60 * 60_000;

/** The minutes between UTC and Paris at `at` (60 in winter, 120 in summer), in ms. */
function parisOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/** The last 03:00 Paris time at or before `now`. */
export function lastNightlyStart(now: Date): Date {
  const wall = new Date(now.getTime() + parisOffsetMs(now));
  let start = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), NIGHTLY_HOUR);
  if (start > wall.getTime()) start -= DAY_MS;
  // Back to UTC with the offset of that night (it may differ from now's around a change of time).
  return new Date(start - parisOffsetMs(new Date(start - parisOffsetMs(now))));
}

/**
 * How often a shop is read again: every hour, every 3 h above 5 000 products at its last complete import; doubled
 * while Shopify asks us to slow down (`doubled`). Null for `nightly`: once a night from 03:00.
 */
export function importIntervals(level: ShopifySlowdownLevel | null): { small: number; large: number } | null {
  if (level === "nightly") return null;
  const factor = level === "doubled" ? 2 : 1;
  return { small: CATALOGUE_IMPORT_INTERVAL_MS * factor, large: CATALOGUE_IMPORT_LARGE_INTERVAL_MS * factor };
}

/**
 * « Stocks frais »: queues every published Shopify shop with the import on (not merged into another) whose last import
 * started longer ago than its interval (`importIntervals`, within 5 min) or never did, and with no import under way.
 * While Shopify asks for the nightly rhythm, a shop is due once after each 03:00 (Paris). The shop id is the job's
 * singleton key, so a shop already queued or being imported is not queued twice. Returns how many shops were offered
 * to the queue.
 */
export async function planCatalogueImports(db: Database, queue: ImportQueue, now = new Date()): Promise<number> {
  const slowdown = await readShopifySlowdown(db, now);
  const intervals = importIntervals(slowdown?.level ?? null);
  const startedAt = schema.shops.importStartedAt;
  let startedBefore: ReturnType<typeof sql>;
  if (intervals) {
    const since = (ms: number) => new Date(now.getTime() - ms + PLAN_GRACE_MS).toISOString();
    startedBefore = sql`case when coalesce(${schema.shops.lastImportSeen}, 0) > ${CATALOGUE_IMPORT_LARGE_SHOP}
      then ${since(intervals.large)}::timestamptz else ${since(intervals.small)}::timestamptz end`;
  } else {
    startedBefore = sql`${lastNightlyStart(now).toISOString()}::timestamptz`;
  }
  const shops = await db
    .select({ id: schema.shops.id })
    .from(schema.shops)
    .where(
      and(
        eq(schema.shops.importEnabled, true),
        eq(schema.shops.status, "published"),
        eq(schema.shops.platform, "shopify"),
        isNull(schema.shops.mergedIntoId),
        sql`(${startedAt} is null or ${startedAt} < ${startedBefore})`,
        importNotUnderWay(now),
      ),
    );
  let planned = 0;
  for (const shop of shops) {
    // « En attente » in the admin before the job exists (the worker then writes « running »); an import already
    // under way keeps its state, a dead one is replaced.
    await db
      .update(schema.shops)
      .set({ importState: "queued", importStartedAt: now })
      .where(and(eq(schema.shops.id, shop.id), importNotUnderWay(now)));
    try {
      await queue.send(CATALOGUE_IMPORT_QUEUE, { shopId: shop.id }, { singletonKey: shop.id });
      planned += 1;
    } catch (error) {
      console.error(`catalogue import: cannot queue shop ${shop.id}`, error);
      await db
        .update(schema.shops)
        .set({ importState: null })
        .where(
          and(
            eq(schema.shops.id, shop.id),
            eq(schema.shops.importState, "queued"),
            eq(schema.shops.importStartedAt, now),
          ),
        );
    }
  }
  return planned;
}
