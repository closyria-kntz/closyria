import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * Plans and what they allow. `plans.id` is a stable text id: the default plan « Gratuit » is `free`
 * (created by the migration), so code can reference it without a lookup.
 * Added by hand in migrations/0003_entitlements.sql: the « Gratuit » plan and its starting values,
 * which are edited in the admin later.
 */
export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  visible: boolean("visible").default(true).notNull(),
  version: integer("version").default(1).notNull(),
});

/**
 * One row per (plan, key). A missing row means the plan does not allow the key (limit 0).
 * `enabled = false` also means 0; `enabled` with a null `limit_value` means unlimited.
 */
export const planEntitlements = pgTable(
  "plan_entitlements",
  {
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    limitValue: integer("limit_value"),
    enabled: boolean("enabled").default(true).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.planId, t.key] }),
    check("plan_entitlements_limit_check", sql`${t.limitValue} IS NULL OR ${t.limitValue} >= 0`),
  ],
);

/** The plan a user is on. One row per user; no row (or an ended one) means the default plan. */
export const userPlans = pgTable(
  "user_plans",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).defaultNow().notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    source: text("source", { enum: ["default", "stripe", "gift"] })
      .default("default")
      .notNull(),
  },
  (t) => [check("user_plans_source_check", sql`${t.source} IN ('default', 'stripe', 'gift')`)],
);

/** Consumption of a monthly key. `period` is `YYYY-MM`, in UTC. */
export const usageCounters = pgTable(
  "usage_counters",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    period: text("period").notNull(),
    value: integer("value").default(0).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key, t.period] }),
    check("usage_counters_value_check", sql`${t.value} >= 0`),
  ],
);
