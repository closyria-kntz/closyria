import {
  audienceSchema,
  captureErrorCodeSchema,
  captureMethodSchema,
  captureModeSchema,
  captureStatusSchema,
  captureTriggerSchema,
  childDetailSchema,
  classifiedBySchema,
  listingKindSchema,
  platformSchema,
  productCaptureStatusSchema,
  productSourceSchema,
  seasonSchema,
  shopStatusSchema,
} from "@closyria/shared";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { oneOf } from "./helpers";
import { categories, colors, materials, patterns } from "./reference";

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

/** A shop (brand or second-hand marketplace) that products are captured from. */
export const shops = pgTable(
  "shops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    status: text("status").notNull().default("pending"),
    platform: text("platform").notNull().default("unknown"),
    captureMode: text("capture_mode").notNull().default("auto"),
    listingKind: text("listing_kind").notNull().default("catalog"),
    /** Reference page of the monitoring. */
    testUrl: text("test_url"),
    mergedIntoId: uuid("merged_into_id").references((): AnyPgColumn => shops.id, { onDelete: "set null" }),
    /** Set by the admin (« boutique de la semaine »): the shop featured most recently is the « une » of « Découvrir ». */
    featuredAt: timestamp("featured_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("shops_status_check", oneOf(t.status, shopStatusSchema.options)),
    check("shops_platform_check", oneOf(t.platform, platformSchema.options)),
    check("shops_capture_mode_check", oneOf(t.captureMode, captureModeSchema.options)),
    check("shops_listing_kind_check", oneOf(t.listingKind, listingKindSchema.options)),
  ],
);

/** Hostnames of a shop: lowercase, without `www.`. */
export const shopDomains = pgTable("shop_domains", {
  domain: text("domain").primaryKey(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shops.id, { onDelete: "cascade" }),
});

/** Delivery options of a shop (« Standard, 6,90 €, offert dès 80 € »), edited in the admin; a group order copies one. */
export const shopShippingOptions = pgTable(
  "shop_shipping_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    shippingCents: integer("shipping_cents").notNull(),
    freeFromCents: integer("free_from_cents"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("shop_shipping_options_shop_id_idx").on(t.shopId),
    check("shop_shipping_options_label_check", sql`char_length(${t.label}) BETWEEN 1 AND 320`),
    check("shop_shipping_options_shipping_check", sql`${t.shippingCents} >= 0`),
    check("shop_shipping_options_free_from_check", sql`${t.freeFromCents} IS NULL OR ${t.freeFromCents} > 0`),
  ],
);

/** Prices are in cents with an ISO 4217 currency. */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    canonicalUrl: text("canonical_url").notNull().unique(),
    externalId: text("external_id"),
    /** Null until a capture or a manual entry fills it. */
    name: text("name"),
    brand: text("brand"),
    description: text("description"),
    currency: text("currency"),
    priceCents: integer("price_cents"),
    compareAtCents: integer("compare_at_cents"),
    source: text("source").notNull().default("captured"),
    captureStatus: text("capture_status").notNull().default("pending"),
    lastCapturedAt: timestamp("last_captured_at", { withTimezone: true }),
    /** When the shop put the product online. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    gtin: text("gtin"),
    sku: text("sku"),
    /** Shop breadcrumb, keywords, colours, material, care, collection, as read (lengths capped). */
    shopData: jsonb("shop_data").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    audience: text("audience"),
    childDetail: text("child_detail"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    colorId: uuid("color_id").references(() => colors.id, { onDelete: "set null" }),
    materialId: uuid("material_id").references(() => materials.id, { onDelete: "set null" }),
    patternId: uuid("pattern_id").references(() => patterns.id, { onDelete: "set null" }),
    season: text("season"),
    classifiedBy: text("classified_by").notNull().default("rule"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("products_shop_id_idx").on(t.shopId),
    index("products_category_id_idx").on(t.categoryId),
    index("products_color_id_idx").on(t.colorId),
    index("products_material_id_idx").on(t.materialId),
    index("products_pattern_id_idx").on(t.patternId),
    check("products_audience_check", sql`${t.audience} IS NULL OR ${oneOf(t.audience, audienceSchema.options)}`),
    check(
      "products_child_detail_check",
      sql`${t.childDetail} IS NULL OR ${oneOf(t.childDetail, childDetailSchema.options)}`,
    ),
    check("products_season_check", sql`${t.season} IS NULL OR ${oneOf(t.season, seasonSchema.options)}`),
    check("products_classified_by_check", oneOf(t.classifiedBy, classifiedBySchema.options)),
    check("products_source_check", oneOf(t.source, productSourceSchema.options)),
    check("products_capture_status_check", oneOf(t.captureStatus, productCaptureStatusSchema.options)),
    check("products_currency_check", sql`char_length(${t.currency}) = 3`),
    check("products_description_check", sql`${t.description} IS NULL OR char_length(${t.description}) <= 5000`),
    check(
      "products_prices_check",
      sql`${t.priceCents} >= 0 AND (${t.compareAtCents} IS NULL OR ${t.compareAtCents} >= 0)`,
    ),
  ],
);

/** At most 8 per product (enforced by the writer). `key` is `products/<productId>/<hash>.webp`. */
export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    key: text("key").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    /** Hash of the origin URL. */
    sourceHash: text("source_hash").notNull(),
  },
  (t) => [
    unique("product_images_product_source_hash_unique").on(t.productId, t.sourceHash),
    check("product_images_dimensions_check", sql`${t.width} > 0 AND ${t.height} > 0`),
  ],
);

export const productSizes = pgTable(
  "product_sizes",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    position: integer("position").notNull(),
    available: boolean("available").notNull(),
    /** Only when different from the product's price. */
    priceCents: integer("price_cents"),
  },
  (t) => [
    unique("product_sizes_product_label_unique").on(t.productId, t.label),
    check("product_sizes_label_check", sql`char_length(${t.label}) BETWEEN 1 AND 40`),
  ],
);

/** One row per successful capture. */
export const productHistory = pgTable(
  "product_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    seenAt: timestamp("seen_at", { withTimezone: true }).defaultNow().notNull(),
    priceCents: integer("price_cents").notNull(),
    /** e.g. `{"M": true, "L": false}`. */
    sizes: jsonb("sizes").$type<Record<string, boolean>>().notNull(),
  },
  (t) => [index("product_history_product_seen_idx").on(t.productId, t.seenAt)],
);

/** Every capture attempt; shop health and the dashboard are computed from it. */
export const captures = pgTable(
  "captures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /** The address the capture was requested for (canonicalised), read by the worker for every trigger. */
    url: text("url").notNull(),
    trigger: text("trigger").notNull(),
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    status: text("status").notNull().default("queued"),
    /** Name, price and sizes are saved. */
    dataReady: boolean("data_ready").notNull().default(false),
    method: text("method"),
    errorCode: text("error_code"),
    httpStatus: integer("http_status"),
    durationMs: integer("duration_ms"),
    /** The extracted product, for `admin_test` only. */
    result: jsonb("result"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("captures_shop_created_idx").on(t.shopId, t.createdAt),
    index("captures_status_created_idx").on(t.status, t.createdAt),
    check("captures_trigger_check", oneOf(t.trigger, captureTriggerSchema.options)),
    check("captures_status_check", oneOf(t.status, captureStatusSchema.options)),
    check("captures_method_check", sql`${t.method} IS NULL OR ${oneOf(t.method, captureMethodSchema.options)}`),
    check(
      "captures_error_code_check",
      sql`${t.errorCode} IS NULL OR ${oneOf(t.errorCode, captureErrorCodeSchema.options)}`,
    ),
  ],
);
