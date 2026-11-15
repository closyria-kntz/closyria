import { sql } from "drizzle-orm";
import { bigint, check, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Settings the admin changes without a deploy, one row per key (`AI_MONTHLY_CAP_SETTING`…), each value validated by
 * its own schema in `packages/shared` when read. A missing row means the default.
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * What the AI cost in a month (Paris), in billionths of a dollar from each call's token usage. A call reserves its
 * highest possible cost first (refused past the cap), then settles to the real one.
 */
export const aiUsageMonths = pgTable(
  "ai_usage_months",
  {
    /** `YYYY-MM`. */
    month: text("month").primaryKey(),
    costNanoUsd: bigint("cost_nano_usd", { mode: "number" }).notNull().default(0),
    calls: integer("calls").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("ai_usage_months_month_check", sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check("ai_usage_months_cost_check", sql`${t.costNanoUsd} >= 0 AND ${t.calls} >= 0`),
  ],
);
