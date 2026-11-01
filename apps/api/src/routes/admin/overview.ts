import { and, count, type Database, gte, lt, schema, sql } from "@closyria/db";
import { adminOverviewSchema } from "@closyria/shared";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { defineAccess } from "../../access";
import type { AdminEnv } from "../../admin-audit";

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
      "`signupsToday`: accounts (not anonymous) created during the current UTC day.",
    responses: {
      200: { description: "Figures", content: { "application/json": { schema: adminOverviewSchema } } },
    },
  }),
  "admin",
);

export function overviewRoutes(deps: AdminDeps) {
  const now = deps.now ?? (() => new Date());
  return new OpenAPIHono<AdminEnv>().openapi(overviewRoute, async (c) => {
    const { start, end } = utcDay(now());
    const { user, events } = schema;
    const anonymous = sql<boolean>`coalesce(${user.isAnonymous}, false)`;
    const [[users], [today]] = await Promise.all([
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
    ]);
    const total = users?.total ?? 0;
    const anonymousCount = users?.anonymous ?? 0;
    return c.json(
      {
        users: { total, anonymous: anonymousCount, registered: total - anonymousCount },
        eventsToday: today?.events ?? 0,
        signupsToday: users?.signupsToday ?? 0,
      },
      200,
    );
  });
}
