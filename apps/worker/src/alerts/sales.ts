import { and, type Database, eq, inArray, schema } from "@closyria/db";
import { ALERT_TIME_ZONE, parisDay } from "@closyria/shared";
import type { PgBoss } from "pg-boss";
import { followedItem } from "./detect";

/** pg-boss queue of the daily sales check (no data). */
export const SALE_PERIOD_QUEUE = "alert-sale-periods";
/** « Les soldes commencent {jour} »: this many days before the first day, then on the day itself. */
export const SALE_NOTICE_DAYS_BEFORE = 2;
/** Every morning, before the earliest digest hour (8:00 Paris). */
export const SALE_PERIOD_CRON = "0 7 * * *";

/** `YYYY-MM-DD` plus `days` (calendar arithmetic, no time zone involved). */
function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
}

/**
 * The day's sales notices: for each sale period starting in 2 days or today (Paris), one `sale_period` event for that
 * day's digest to each person with at least one followed wish. Running twice the same day adds nothing. Returns how
 * many events were created.
 */
export async function detectSalePeriods(db: Database, at: Date): Promise<number> {
  const today = parisDay(at);
  const periods = await db
    .select({ id: schema.salePeriods.id })
    .from(schema.salePeriods)
    .where(inArray(schema.salePeriods.startsOn, [today, addDays(today, SALE_NOTICE_DAYS_BEFORE)]));
  if (periods.length === 0) return 0;

  const followers = await db.selectDistinct({ userId: schema.items.userId }).from(schema.items).where(followedItem);
  let created = 0;
  for (const period of periods) {
    const already = await db
      .select({ userId: schema.alertEvents.userId })
      .from(schema.alertEvents)
      .where(
        and(
          eq(schema.alertEvents.kind, "sale_period"),
          eq(schema.alertEvents.salePeriodId, period.id),
          eq(schema.alertEvents.digestOn, today),
        ),
      );
    const told = new Set(already.map((row) => row.userId));
    const rows = followers
      .filter((f) => !told.has(f.userId))
      .map((f) => ({ userId: f.userId, kind: "sale_period", salePeriodId: period.id, digestOn: today, createdAt: at }));
    if (rows.length === 0) continue;
    await db.insert(schema.alertEvents).values(rows);
    created += rows.length;
  }
  return created;
}

/** Creates the daily sales queue, processes it, and schedules it every morning at 07:00 Paris. */
export async function registerSalePeriodQueue(boss: PgBoss, db: Database): Promise<void> {
  await boss.createQueue(SALE_PERIOD_QUEUE);
  await boss.work(SALE_PERIOD_QUEUE, async () => {
    const created = await detectSalePeriods(db, new Date());
    if (created > 0) console.log(`sale periods: ${created} notice(s) for the digest`);
  });
  await boss.schedule(SALE_PERIOD_QUEUE, SALE_PERIOD_CRON, undefined, { tz: ALERT_TIME_ZONE, key: "daily-sales" });
}
