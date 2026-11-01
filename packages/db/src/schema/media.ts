import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * A user's photo, re-encoded to WebP without metadata, stored in object storage under `key`
 * (`users/<userId>/<id>.webp`). When an anonymous user signs in, the row moves to the account but the key
 * keeps the anonymous id: keys are opaque, never parsed. Deleting the user cascades to the rows; removing
 * the objects belongs to account deletion (chantier 6).
 */
export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull().unique(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("media_user_id_idx").on(t.userId),
    check("media_dimensions_check", sql`${t.sizeBytes} > 0 AND ${t.width} > 0 AND ${t.height} > 0`),
  ],
);
