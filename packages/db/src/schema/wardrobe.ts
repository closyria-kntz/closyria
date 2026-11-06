import {
  audienceSchema,
  childDetailSchema,
  itemEventTypeSchema,
  itemStageSchema,
  MAX_NOTES,
  MAX_PROFILE_NAME,
  MAX_SALE_CHANNEL,
  MAX_SIZE_LABEL,
  MAX_SIZE_NOTE,
  MAX_TAG_NAME,
  MAX_WISHLIST_NAME,
  profileColorSchema,
} from "@closyria/shared";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { products } from "./catalog";
import { oneOf } from "./helpers";
import { media } from "./media";
import { categories, colors } from "./reference";

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const owner = () =>
  text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" });
const lengthBetween = (column: AnyPgColumn, max: number) =>
  sql`char_length(${column}) BETWEEN 1 AND ${sql.raw(String(max))}`;
const atMost = (column: AnyPgColumn, max: number) =>
  sql`${column} IS NULL OR char_length(${column}) <= ${sql.raw(String(max))}`;

/** A person she keeps items for ("Moi", a child...). Owned by the user. */
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    name: text("name").notNull(),
    audience: text("audience").notNull(),
    childDetail: text("child_detail"),
    /** Name of a palette token, never a raw colour. */
    color: text("color").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("profiles_user_id_idx").on(t.userId),
    check("profiles_name_check", lengthBetween(t.name, MAX_PROFILE_NAME)),
    check("profiles_audience_check", oneOf(t.audience, audienceSchema.options)),
    check(
      "profiles_child_detail_check",
      sql`${t.childDetail} IS NULL OR ${oneOf(t.childDetail, childDetailSchema.options)}`,
    ),
    check("profiles_color_check", oneOf(t.color, profileColorSchema.options)),
  ],
);

/** An item she keeps: a product (common record) plus her own data. Owned by the user. */
export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    /** No action: a profile that still holds items cannot be deleted. */
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id),
    /** Not null in 2a; nullable later for items born from a photo (2b). */
    productId: uuid("product_id").references(() => products.id),
    stage: text("stage").notNull().default("spotted"),
    favorite: boolean("favorite").notNull().default(false),
    sizeLabel: text("size_label"),
    sizeNote: text("size_note"),
    notes: text("notes"),
    pricePaidCents: integer("price_paid_cents"),
    salePriceCents: integer("sale_price_cents"),
    saleChannel: text("sale_channel"),
    nameOverride: text("name_override"),
    brandOverride: text("brand_override"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    colorId: uuid("color_id").references(() => colors.id, { onDelete: "set null" }),
    /** Null = the shop's first photo. The API checks the cover is one of the item's photos. */
    coverMediaId: uuid("cover_media_id").references(() => media.id, { onDelete: "set null" }),
    /** Trash: set when deleted, purged after 30 days. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("items_user_id_stage_idx").on(t.userId, t.stage),
    index("items_profile_id_idx").on(t.profileId),
    index("items_product_id_idx").on(t.productId),
    uniqueIndex("items_user_id_product_id_active_idx").on(t.userId, t.productId).where(sql`${t.deletedAt} IS NULL`),
    check("items_stage_check", oneOf(t.stage, itemStageSchema.options)),
    check("items_size_label_check", atMost(t.sizeLabel, MAX_SIZE_LABEL)),
    check("items_size_note_check", atMost(t.sizeNote, MAX_SIZE_NOTE)),
    check("items_notes_check", atMost(t.notes, MAX_NOTES)),
    check("items_sale_channel_check", atMost(t.saleChannel, MAX_SALE_CHANNEL)),
    check(
      "items_cents_check",
      sql`(${t.pricePaidCents} IS NULL OR ${t.pricePaidCents} >= 0) AND (${t.salePriceCents} IS NULL OR ${t.salePriceCents} >= 0)`,
    ),
  ],
);

/** History: one row per stage change and per transfer between profiles. */
export const itemEvents = pgTable(
  "item_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    stage: text("stage"),
    fromProfileId: uuid("from_profile_id").references(() => profiles.id, { onDelete: "set null" }),
    toProfileId: uuid("to_profile_id").references(() => profiles.id, { onDelete: "set null" }),
    /** Date of the event, editable by the user. */
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    amountCents: integer("amount_cents"),
    createdAt: createdAt(),
  },
  (t) => [
    index("item_events_item_id_at_idx").on(t.itemId, t.at),
    check("item_events_type_check", oneOf(t.type, itemEventTypeSchema.options)),
    check("item_events_stage_check", sql`${t.stage} IS NULL OR ${oneOf(t.stage, itemStageSchema.options)}`),
    check("item_events_amount_check", sql`${t.amountCents} IS NULL OR ${t.amountCents} >= 0`),
  ],
);

/** Her private photos of an item (the files are `media` rows). At most 10 per item, enforced by the API. */
export const itemMedia = pgTable(
  "item_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    index("item_media_item_id_idx").on(t.itemId),
    uniqueIndex("item_media_item_id_media_id_idx").on(t.itemId, t.mediaId),
  ],
);

export const wishlists = pgTable(
  "wishlists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    name: text("name").notNull(),
    /** SHA-256 of the share token; null = not shared. The token itself is never stored. */
    shareTokenHash: text("share_token_hash").unique(),
    sharedAt: timestamp("shared_at", { withTimezone: true }),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("wishlists_user_id_idx").on(t.userId),
    check("wishlists_name_check", lengthBetween(t.name, MAX_WISHLIST_NAME)),
  ],
);

export const wishlistItems = pgTable(
  "wishlist_items",
  {
    wishlistId: uuid("wishlist_id")
      .notNull()
      .references(() => wishlists.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.wishlistId, t.itemId] }), index("wishlist_items_item_id_idx").on(t.itemId)],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    name: text("name").notNull(),
    color: text("color"),
  },
  (t) => [
    uniqueIndex("tags_user_id_lower_name_idx").on(t.userId, sql`lower(${t.name})`),
    check("tags_name_check", lengthBetween(t.name, MAX_TAG_NAME)),
    check("tags_color_check", sql`${t.color} IS NULL OR ${oneOf(t.color, profileColorSchema.options)}`),
  ],
);

export const itemTags = pgTable(
  "item_tags",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.tagId] }), index("item_tags_tag_id_idx").on(t.tagId)],
);
