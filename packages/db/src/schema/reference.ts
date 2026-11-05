import { sql } from "drizzle-orm";
import { type AnyPgColumn, check, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";

const keywords = () => text("keywords").array().notNull().default(sql`'{}'::text[]`);

/** Category tree (e.g. Clothing > Dresses > Maxi dress). Seeded at worker start, then edited by the admin. */
export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, { onDelete: "set null" }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  keywords: keywords(),
});

export const colors = pgTable(
  "colors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    /** Display colour, `#RRGGBB`. */
    hex: text("hex").notNull(),
    keywords: keywords(),
  },
  (t) => [check("colors_hex_check", sql`${t.hex} ~ '^#[0-9A-Fa-f]{6}$'`)],
);

export const materials = pgTable("materials", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  keywords: keywords(),
});

export const patterns = pgTable("patterns", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  keywords: keywords(),
});
