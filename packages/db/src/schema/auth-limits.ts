import { bigint, integer, pgTable, text } from "drizzle-orm/pg-core";

/**
 * Per e-mail limit on sign-in code sending (spec §9: limits per IP and per account).
 * `key` is a SHA-256 of the lower-cased address: the address itself is never stored here.
 * Kept apart from Better Auth's rate_limit table, whose pruning only knows its own windows.
 */
export const emailRateLimit = pgTable("email_rate_limit", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: bigint("window_start", { mode: "number" }).notNull(),
});
