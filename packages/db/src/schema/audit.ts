import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

/** Free-form context of an audit entry: only what the handler chose to note, plus method, path and status. */
export type AuditDetails = Record<string, string | number | boolean | null>;

/**
 * Journal of admin actions (spec §8): one row per admin request that changes something, written by the API's
 * `auditMiddleware`. Never the request body. Not a user's data: not an owned table, and the row outlives the
 * admin's account (`admin_id` becomes null). `created_at` keeps milliseconds only, so that the keyset cursor
 * (created_at, id) round-trips exactly through a JavaScript Date.
 */
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: text("admin_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    target: text("target"),
    details: jsonb("details").$type<AuditDetails>().default(sql`'{}'::jsonb`).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  },
  (t) => [index("admin_audit_log_created_at_id_idx").on(t.createdAt.desc(), t.id.desc())],
);
