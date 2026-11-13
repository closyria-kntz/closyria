import { and, count, type Database, eq, gte, importNotUnderWay, isNull, lt, schema, sql } from "@closyria/db";
import { adminOverviewSchema, CATALOGUE_IMPORT_LARGE_SHOP, catalogueImportIntervals } from "@closyria/shared";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { defineAccess } from "../../access";
import type { AdminEnv } from "../../admin-audit";
import { HEALTH_WINDOW_MS, loadShopStats, REAL_ATTEMPT, shopHealth } from "../../catalog/health";
import { shopifySlowdownOf } from "../../catalog/slowdown";

export type AdminDeps = {
  db: Database;
  /** Clock, injectable for tests. */
  now?: () => Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Start (inclusive) and end (exclusive) of the UTC day containing `date`. */
export function utcDay(date: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

const overviewRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/admin/overview",
    summary: "Admin dashboard figures",
    description:
      "Aggregates only (spec D13). `users.anonymous` counts anonymous sessions' users, `users.registered` the others. " +
      "`eventsToday`: audience events that occurred during the current UTC day. " +
      "`signupsToday`: accounts (not anonymous) created during the current UTC day. " +
      "`captures`: rates and durations cover finished captures that were real fetch attempts (not 24 h reuses nor queue failures); `shops.down` counts published, " +
      "automatically captured shops whose two latest monitor captures failed (sheet refreshes are left out of every capture figure). `shopifySlowdown`: « Shopify nous demande de ralentir » " +
      "(after a 429/430 from a Shopify shop: imports doubled, else nightly) until `until`; null when none. `rereadLate`: " +
      "shops due for their catalogue re-read whose last import started over twice their interval ago (« Relecture en " +
      "retard »).",
    responses: {
      200: { description: "Figures", content: { "application/json": { schema: adminOverviewSchema } } },
    },
  }),
  "admin",
);

/**
 * « Relecture en retard »: the shops the planner should re-read (published Shopify shops with the import on, not
 * merged, no import under way) whose last import started (else, never imported, the shop was created) more than twice
 * their interval ago: 2 h, 6 h above 5 000 products; doubled while Shopify asks to slow down; a day in its nightly
 * rhythm. The planner takes the longest waiting first, so any such shop means it does not keep up.
 */
async function countRereadLate(db: Database, at: Date, level: "doubled" | "nightly" | null): Promise<number> {
  const intervals = catalogueImportIntervals(level) ?? { small: DAY_MS, large: DAY_MS };
  const before = (ms: number) => new Date(at.getTime() - 2 * ms).toISOString();
  const [row] = await db
    .select({ n: count() })
    .from(schema.shops)
    .where(
      and(
        eq(schema.shops.importEnabled, true),
        eq(schema.shops.status, "published"),
        eq(schema.shops.platform, "shopify"),
        // A « grande enseigne » is never imported by the planner.
        eq(schema.shops.isMajorBrand, false),
        isNull(schema.shops.mergedIntoId),
        importNotUnderWay(at),
        sql`coalesce(${schema.shops.importStartedAt}, ${schema.shops.createdAt}) < case
          when coalesce(${schema.shops.lastImportSeen}, 0) > ${CATALOGUE_IMPORT_LARGE_SHOP}
          then ${before(intervals.large)}::timestamptz else ${before(intervals.small)}::timestamptz end`,
      ),
    );
  return row?.n ?? 0;
}

export function overviewRoutes(deps: AdminDeps) {
  const now = deps.now ?? (() => new Date());
  return new OpenAPIHono<AdminEnv>().openapi(overviewRoute, async (c) => {
    const { start, end } = utcDay(now());
    const { user, events } = schema;
    const anonymous = sql<boolean>`coalesce(${user.isAnonymous}, false)`;
    const at = now();
    const since7d = new Date(at.getTime() - HEALTH_WINDOW_MS).toISOString();
    const since24h = new Date(at.getTime() - DAY_MS).toISOString();
    const [[users], [today], captureFigures, [pending], monitored, shopifySlowdown] = await Promise.all([
      deps.db
        .select({
          total: count(),
          anonymous: count(sql`case when ${anonymous} then 1 end`),
          signupsToday: count(
            // Column-bound comparisons: the dates are encoded like the column (UTC), whatever the server's time zone.
            sql`case when not ${anonymous} and ${and(gte(user.createdAt, start), lt(user.createdAt, end))} then 1 end`,
          ),
        })
        .from(user),
      deps.db
        .select({ events: count() })
        .from(events)
        .where(and(gte(events.occurredAt, start), lt(events.occurredAt, end))),
      deps.db.execute<{
        last24h: number;
        last7d: number;
        finished: number;
        succeeded: number;
        shopify: number;
        jsonld: number;
        opengraph: number;
        median: number | null;
      }>(sql`
        select
          (count(*) filter (where created_at >= ${since24h}::timestamptz))::int as last24h,
          (count(*) filter (where created_at >= ${since7d}::timestamptz))::int as last7d,
          (count(*) filter (where status in ('succeeded', 'failed') and ${REAL_ATTEMPT}))::int as finished,
          (count(*) filter (where status = 'succeeded' and ${REAL_ATTEMPT}))::int as succeeded,
          (count(*) filter (where status = 'succeeded' and method = 'shopify'))::int as shopify,
          (count(*) filter (where status = 'succeeded' and method = 'jsonld'))::int as jsonld,
          (count(*) filter (where status = 'succeeded' and method = 'opengraph'))::int as opengraph,
          (percentile_cont(0.5) within group (order by duration_ms) filter (where status = 'succeeded' and ${REAL_ATTEMPT}))::float8 as median
        from captures
        -- Sheet refreshes (« stocks frais ») are not counted: automatic, many, and dropped when late.
        where created_at >= ${since7d}::timestamptz and trigger <> 'refresh'`),
      deps.db
        .select({ pending: count() })
        .from(schema.shops)
        .where(and(eq(schema.shops.status, "pending"), isNull(schema.shops.mergedIntoId))),
      deps.db
        .select({ id: schema.shops.id, status: schema.shops.status, captureMode: schema.shops.captureMode })
        .from(schema.shops)
        .where(
          and(
            eq(schema.shops.status, "published"),
            eq(schema.shops.captureMode, "auto"),
            isNull(schema.shops.mergedIntoId),
          ),
        ),
      shopifySlowdownOf(deps.db, at),
    ]);
    const rereadLate = await countRereadLate(deps.db, at, shopifySlowdown?.level ?? null);
    const stats = await loadShopStats(
      deps.db,
      at,
      monitored.map((s) => s.id),
    );
    const down = monitored.filter(
      (shop) =>
        shopHealth({
          status: "published",
          captureMode: "auto",
          lastMonitors: stats.get(shop.id)?.lastMonitors ?? [],
          successRate7d: stats.get(shop.id)?.successRate7d ?? null,
        }) === "down",
    ).length;
    const cap = captureFigures.rows[0];
    const total = users?.total ?? 0;
    const anonymousCount = users?.anonymous ?? 0;
    return c.json(
      {
        users: { total, anonymous: anonymousCount, registered: total - anonymousCount },
        eventsToday: today?.events ?? 0,
        signupsToday: users?.signupsToday ?? 0,
        captures: {
          last24h: cap?.last24h ?? 0,
          last7d: cap?.last7d ?? 0,
          successRate7d: cap && cap.finished > 0 ? cap.succeeded / cap.finished : null,
          byMethod: { shopify: cap?.shopify ?? 0, jsonld: cap?.jsonld ?? 0, opengraph: cap?.opengraph ?? 0 },
          medianDurationMs: cap?.median ?? null,
        },
        shops: { pending: pending?.pending ?? 0, down },
        shopifySlowdown,
        rereadLate,
      },
      200,
    );
  });
}
