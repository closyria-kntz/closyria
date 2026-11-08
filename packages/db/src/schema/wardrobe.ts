import {
  audienceSchema,
  budgetPeriodSchema,
  childDetailSchema,
  itemEventTypeSchema,
  itemStageSchema,
  MAX_LOVE_LEVEL_LABEL,
  MAX_NOTES,
  MAX_PHOTO_IMPORT_URL,
  MAX_PROFILE_NAME,
  MAX_SALE_CHANNEL,
  MAX_SIZE_LABEL,
  MAX_SIZE_NOTE,
  MAX_TAG_NAME,
  MAX_WHY,
  MAX_WISHLIST_NAME,
  OPINION_NAME_MAX_CODE_POINTS,
  OPINION_NOTE_MAX_CODE_POINTS,
  photoImportErrorSchema,
  photoImportStatusSchema,
  profileColorSchema,
} from "@closyria/shared";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
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
    /** 1 Bof, 2 J'aime, 3 Mims, 4 En feu; null = no level. */
    loveLevel: smallint("love_level"),
    priority: boolean("priority").notNull().default(false),
    /** Her « Pourquoi ? », one sentence. */
    why: text("why"),
    /** In her « Préparer une commande » selection. */
    inOrderDraft: boolean("in_order_draft").notNull().default(false),
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
    index("items_order_draft_idx").on(t.userId, t.profileId).where(sql`${t.inOrderDraft}`),
    check("items_love_level_check", sql`${t.loveLevel} IS NULL OR ${t.loveLevel} BETWEEN 1 AND 4`),
    check("items_why_check", atMost(t.why, MAX_WHY)),
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
    /** What an `ordered` (or `returned`) event counts in a budget: the amount, else the shop's price, else 0. */
    spentCents: integer("spent_cents"),
    createdAt: createdAt(),
  },
  (t) => [
    index("item_events_item_id_at_idx").on(t.itemId, t.at),
    check("item_events_type_check", oneOf(t.type, itemEventTypeSchema.options)),
    check("item_events_stage_check", sql`${t.stage} IS NULL OR ${oneOf(t.stage, itemStageSchema.options)}`),
    check("item_events_amount_check", sql`${t.amountCents} IS NULL OR ${t.amountCents} >= 0`),
    check("item_events_spent_check", sql`${t.spentCents} IS NULL OR ${t.spentCents} >= 0`),
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
    /** The share token, encrypted so she can see her link again; null = not shared (or shared before this existed). */
    shareTokenEncrypted: text("share_token_encrypted"),
    sharedAt: timestamp("shared_at", { withTimezone: true }),
    /** Friends may leave opinions on the shared list. */
    allowOpinions: boolean("allow_opinions").notNull().default(true),
    showOwnerName: boolean("show_owner_name").notNull().default(true),
    showOwnerOpinions: boolean("show_owner_opinions").notNull().default(true),
    showBudget: boolean("show_budget").notNull().default(false),
    /** When she last looked at the opinions; newer ones are « new ». */
    opinionsSeenAt: timestamp("opinions_seen_at", { withTimezone: true }),
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

/** Products she opened lately (« Derniers liens »). One row per product, the latest visit wins. Owned by the user. */
export const recentProducts = pgTable(
  "recent_products",
  {
    userId: owner(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    visitedAt: timestamp("visited_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.productId] }),
    index("recent_products_user_id_visited_at_idx").on(t.userId, t.visitedAt.desc()),
  ],
);

/** A photo fetched from a URL for an item, until she attaches it; purged after 24 h. Owned by the user. */
export const photoImports = pgTable(
  "photo_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    status: text("status").notNull().default("queued"),
    errorCode: text("error_code"),
    /** Filled once `ready`: the stored object and what the worker measured. */
    mediaKey: text("media_key"),
    contentType: text("content_type"),
    sizeBytes: integer("size_bytes"),
    width: integer("width"),
    height: integer("height"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("photo_imports_user_id_idx").on(t.userId),
    index("photo_imports_item_id_idx").on(t.itemId),
    index("photo_imports_created_at_idx").on(t.createdAt),
    check("photo_imports_url_check", lengthBetween(t.url, MAX_PHOTO_IMPORT_URL)),
    check("photo_imports_status_check", oneOf(t.status, photoImportStatusSchema.options)),
    check(
      "photo_imports_error_code_check",
      sql`${t.errorCode} IS NULL OR ${oneOf(t.errorCode, photoImportErrorSchema.options)}`,
    ),
  ],
);

/** A friend's opinion on an item of a shared list; one per (list, item, name). Goes with the list or the item. */
export const wishlistOpinions = pgTable(
  "wishlist_opinions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wishlistId: uuid("wishlist_id")
      .notNull()
      .references(() => wishlists.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    authorName: text("author_name").notNull(),
    /** Normalised name (case, accents, spaces) that makes two spellings the same author. */
    authorNameKey: text("author_name_key").notNull(),
    level: smallint("level").notNull(),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("wishlist_opinions_author_idx").on(t.wishlistId, t.itemId, t.authorNameKey),
    index("wishlist_opinions_wishlist_id_updated_at_idx").on(t.wishlistId, t.updatedAt),
    index("wishlist_opinions_item_id_idx").on(t.itemId),
    // Code points (what char_length counts), the same caps as the shared schemas: the user-facing limits are in
    // graphemes (40 and 200), enforced by the API; a grapheme can be several code points.
    check("wishlist_opinions_author_name_check", lengthBetween(t.authorName, OPINION_NAME_MAX_CODE_POINTS)),
    check("wishlist_opinions_level_check", sql`${t.level} BETWEEN 1 AND 4`),
    check("wishlist_opinions_note_check", atMost(t.note, OPINION_NOTE_MAX_CODE_POINTS)),
  ],
);

/** Which device claimed a name on a list, so nobody else writes under it. Goes with the list. */
export const wishlistOpinionDevices = pgTable(
  "wishlist_opinion_devices",
  {
    wishlistId: uuid("wishlist_id")
      .notNull()
      .references(() => wishlists.id, { onDelete: "cascade" }),
    authorNameKey: text("author_name_key").notNull(),
    /** SHA-256 of the device key; the key itself stays on her friend's device. */
    deviceKeyHash: text("device_key_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "wishlist_opinion_devices_pk", columns: [t.wishlistId, t.authorNameKey, t.deviceKeyHash] }),
  ],
);

/** Her own names and emojis for the 4 levels; no row = the starting ones. Owned by the user. */
export const loveLevels = pgTable(
  "love_levels",
  {
    userId: owner(),
    level: smallint("level").notNull(),
    /** One grapheme, checked by the API; at most 16 bytes here. */
    emoji: text("emoji").notNull(),
    label: text("label").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.level] }),
    check("love_levels_level_check", sql`${t.level} BETWEEN 1 AND 4`),
    check("love_levels_emoji_check", sql`octet_length(${t.emoji}) BETWEEN 1 AND 16`),
    check("love_levels_label_check", lengthBetween(t.label, MAX_LOVE_LEVEL_LABEL)),
  ],
);

/** A budget for one of her profiles or one of her lists (exactly one), over a period. Owned by the user. */
export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    profileId: uuid("profile_id").references(() => profiles.id, { onDelete: "cascade" }),
    wishlistId: uuid("wishlist_id").references(() => wishlists.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    period: text("period").notNull(),
    /** `custom` only, both inclusive. */
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    /** `none`: what she ordered since then counts. */
    resetAt: timestamp("reset_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("budgets_user_id_idx").on(t.userId),
    uniqueIndex("budgets_profile_id_idx").on(t.profileId).where(sql`${t.profileId} IS NOT NULL`),
    uniqueIndex("budgets_wishlist_id_idx").on(t.wishlistId).where(sql`${t.wishlistId} IS NOT NULL`),
    check("budgets_target_check", sql`(${t.profileId} IS NULL) <> (${t.wishlistId} IS NULL)`),
    check("budgets_amount_check", sql`${t.amountCents} > 0`),
    check("budgets_period_check", oneOf(t.period, budgetPeriodSchema.options)),
    check(
      "budgets_dates_check",
      sql`CASE WHEN ${t.period} = 'custom' THEN ${t.startsOn} IS NOT NULL AND ${t.endsOn} IS NOT NULL AND ${t.startsOn} <= ${t.endsOn} ELSE ${t.startsOn} IS NULL AND ${t.endsOn} IS NULL END`,
    ),
  ],
);
