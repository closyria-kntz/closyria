import { type Database, sql } from "@closyria/db";
import type { CaptureMode, ShopHealth, ShopStatus } from "@closyria/shared";

export const HEALTH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEGRADED_BELOW = 0.8;

export type HealthInput = {
  status: ShopStatus;
  captureMode: CaptureMode;
  /** Outcomes (`succeeded`) of the latest finished monitor captures, most recent first. */
  lastMonitors: boolean[];
  /** Succeeded / finished captures over 7 days, all triggers; null when none finished. */
  successRate7d: number | null;
};

/**
 * SQL condition keeping only real fetch attempts that speak for the shop: not a 24 h reuse (succeeded without a
 * method), not a `queue_unavailable` failure (nothing was fetched), and not a sheet's refresh (« stocks frais »: many,
 * automatic, dropped when late; they would drown the shop's health and the dashboard's figures).
 */
export const REAL_ATTEMPT = sql`not (status = 'succeeded' and method is null)
  and coalesce(error_code, '') <> 'queue_unavailable' and trigger <> 'refresh'`;

/** Only a published shop captured automatically is monitored. */
export function shopHealth(input: HealthInput): ShopHealth {
  if (input.status !== "published" || input.captureMode !== "auto") return "not_applicable";
  const [latest, previous] = input.lastMonitors;
  if (latest === false && previous === false) return "down";
  if (input.successRate7d !== null && input.successRate7d < DEGRADED_BELOW) return "degraded";
  return "ok";
}

export type ShopStats = { lastMonitors: boolean[]; successRate7d: number | null };

/**
 * Monitor outcomes and 7-day success rate of the given shops (all shops when `shopIds` is omitted), in
 * two grouped queries whatever the number of shops. A shop without finished captures has no entry.
 */
export async function loadShopStats(db: Database, now: Date, shopIds?: string[]): Promise<Map<string, ShopStats>> {
  const since = new Date(now.getTime() - HEALTH_WINDOW_MS);
  const scope = shopIds ? sql`and shop_id = any(${sql.param(shopIds)}::uuid[])` : sql``;
  const [monitors, rates] = await Promise.all([
    db.execute<{ shop_id: string; ok: boolean }>(sql`
      select shop_id, ok from (
        select shop_id, status = 'succeeded' as ok,
          row_number() over (partition by shop_id order by finished_at desc nulls last, created_at desc) as rn
        from captures
        where trigger = 'monitor' and status in ('succeeded', 'failed') ${scope}
      ) latest
      where rn <= 2
      order by shop_id, rn`),
    db.execute<{ shop_id: string; succeeded: number; finished: number }>(sql`
      select shop_id,
        (count(*) filter (where status = 'succeeded'))::int as succeeded,
        count(*)::int as finished
      from captures
      where status in ('succeeded', 'failed') and ${REAL_ATTEMPT}
        and created_at >= ${since.toISOString()}::timestamptz ${scope}
      group by shop_id`),
  ]);
  const stats = new Map<string, ShopStats>();
  const entry = (id: string) => {
    const existing = stats.get(id);
    if (existing) return existing;
    const created: ShopStats = { lastMonitors: [], successRate7d: null };
    stats.set(id, created);
    return created;
  };
  for (const row of monitors.rows) entry(row.shop_id).lastMonitors.push(row.ok);
  for (const row of rates.rows)
    entry(row.shop_id).successRate7d = row.finished > 0 ? row.succeeded / row.finished : null;
  return stats;
}
