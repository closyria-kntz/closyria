import { z } from "zod";

/** Closed list of what a plan can limit. Monthly keys are consumed; stock keys are compared to a live count. */
export const entitlementKeys = [
  "wardrobe_items",
  "active_alerts",
  "cutouts_per_month",
  "order_emails_per_month",
  "ai_calls_per_month",
] as const;

export const monthlyKeys = ["cutouts_per_month", "order_emails_per_month", "ai_calls_per_month"] as const;
export const stockKeys = ["wardrobe_items", "active_alerts"] as const;

export const entitlementKeySchema = z.enum(entitlementKeys);
export const monthlyKeySchema = z.enum(monthlyKeys);
export const stockKeySchema = z.enum(stockKeys);

export type EntitlementKey = z.infer<typeof entitlementKeySchema>;
export type MonthlyKey = z.infer<typeof monthlyKeySchema>;
export type StockKey = z.infer<typeof stockKeySchema>;

/** Stable id of the default plan « Gratuit », created by the migration. */
export const DEFAULT_PLAN_ID = "free";
