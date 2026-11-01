import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * First-party audience events (spec D12, CNIL audience-measurement exemption). Never an IP address, never a
 * user agent: only the device family derived from it at ingestion. `path` has no query string or fragment.
 * `user_id` is null for visitors with no session, who stay anonymous; otherwise the row is the user's data
 * (moved on anonymous -> account linking, deleted with the account).
 */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    path: text("path").notNull(),
    device: text("device"),
    props: jsonb("props").$type<Record<string, string | number | boolean>>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("events_name_occurred_at_idx").on(t.name, t.occurredAt),
    index("events_user_id_idx").on(t.userId),
    check("events_device_check", sql`${t.device} IS NULL OR ${t.device} IN ('mobile', 'desktop', 'tablet')`),
  ],
);
