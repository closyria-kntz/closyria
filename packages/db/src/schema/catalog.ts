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
  reportReasonSchema,
  reportResolutionSchema,
  seasonSchema,
  shopifySlowdownLevelSchema,
  shopStatusSchema,
  shopValueSchema,
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
    /** Ticked by the admin (made in France, second hand…): filters of « Découvrir ». */
    values: text("values").array().notNull().default(sql`'{}'::text[]`),
    /**
     * « Grande enseigne » (Zara, Vinted…), set by the admin or the seed: its products stay usable (items, wishlists,
     * links) but never show in « Découvrir », and its catalogue is never imported by the planner.
     */
    isMajorBrand: boolean("is_major_brand").notNull().default(false),
    /** The nightly import of the shop catalogue is on. */
    importEnabled: boolean("import_enabled").notNull().default(false),
    lastImportAt: timestamp("last_import_at", { withTimezone: true }),
    lastImportError: text("last_import_error"),
    /**
     * The import under way: `queued` (« Importer maintenant » or the night's plan), then `running` (the worker). Null
     * when none. A `queued` one older than the job expiry (6 h, `importStartedAt`), or a `running` one whose heartbeat
     * (`importHeartbeatAt`) is over 10 min old, is a dead job, not an import under way.
     */
    importState: text("import_state"),
    /** When the state above was set (queued, then started). */
    importStartedAt: timestamp("import_started_at", { withTimezone: true }),
    /** Written by the running import at its start, after each page and every 30 s within one: proof it is alive. */
    importHeartbeatAt: timestamp("import_heartbeat_at", { withTimezone: true }),
    /** Products the shop's sitemap lists, read at the import's start: the bar's scale before any complete import. */
    importExpected: integer("import_expected"),
    /** Pages and products read by the import under way (reset when the worker starts it). */
    importPages: integer("import_pages").notNull().default(0),
    importSeen: integer("import_seen").notNull().default(0),
    /** Products read, new and removed of the last complete import (« Terminé à … »): never touched while queued. */
    lastImportSeen: integer("last_import_seen"),
    lastImportCreated: integer("last_import_created"),
    lastImportRemoved: integer("last_import_removed"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("shops_status_check", oneOf(t.status, shopStatusSchema.options)),
    check("shops_platform_check", oneOf(t.platform, platformSchema.options)),
    check("shops_capture_mode_check", oneOf(t.captureMode, captureModeSchema.options)),
    check("shops_listing_kind_check", oneOf(t.listingKind, listingKindSchema.options)),
    check("shops_import_state_check", sql`${t.importState} IS NULL OR ${t.importState} IN ('queued', 'running')`),
    check(
      "shops_values_check",
      sql`${t.values} <@ ARRAY[${sql.raw(shopValueSchema.options.map((v) => `'${v}'`).join(", "))}]::text[]`,
    ),
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

/**
 * The searchable text of a product (name and brand), lowercased and without accents by the SQL function
 * `catalog_fold` (migrations 0022 and 0023, no extension needed). The catalogue query uses this exact expression (with its
 * table alias) so that `products_search_idx` serves it.
 */
export const productSearchDocument = (alias?: string) => {
  const col = (name: string) => (alias ? `${alias}."${name}"` : `"${name}"`);
  return sql.raw(
    `to_tsvector('simple'::regconfig, catalog_fold(coalesce(${col("name")}, '') || ' ' || coalesce(${col("brand")}, '')))`,
  );
};

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
    /** `admin` once the admin filed it by hand: the importer no longer touches the category. */
    categorySource: text("category_source").notNull().default("auto"),
    /** Hidden from the catalogue by the admin (reports). */
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    /** Gone from the shop catalogue at the last import; kept for those who want it. */
    removedAt: timestamp("removed_at", { withTimezone: true }),
    /**
     * Hash of the import's listing of the product (everything written from it, plus the shop's listing kind) at its last
     * full import write: the same content, checked again within 7 days, is not written again. Null: never skipped.
     */
    sourceHash: text("source_hash"),
    /**
     * WooCommerce: when the per-size stock (one request per variation) was last read. The listing does not hold it:
     * read for new or changed products, and for every variable product at most once a day. Null: never read.
     */
    variantsCheckedAt: timestamp("variants_checked_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("products_shop_id_idx").on(t.shopId),
    index("products_category_id_idx").on(t.categoryId),
    index("products_color_id_idx").on(t.colorId),
    index("products_material_id_idx").on(t.materialId),
    index("products_pattern_id_idx").on(t.patternId),
    // Text search of « Découvrir » on the name and brand, accents folded by `catalog_fold` (migration 0022).
    index("products_search_idx").using("gin", productSearchDocument()),
    check("products_audience_check", sql`${t.audience} IS NULL OR ${oneOf(t.audience, audienceSchema.options)}`),
    check(
      "products_child_detail_check",
      sql`${t.childDetail} IS NULL OR ${oneOf(t.childDetail, childDetailSchema.options)}`,
    ),
    check("products_season_check", sql`${t.season} IS NULL OR ${oneOf(t.season, seasonSchema.options)}`),
    check("products_classified_by_check", oneOf(t.classifiedBy, classifiedBySchema.options)),
    check("products_category_source_check", oneOf(t.categorySource, ["auto", "admin"])),
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
    // A sheet's refreshes (« stocks frais »): its active capture and last refresh, read per product on every stale sheet.
    index("captures_product_created_idx").on(t.productId, t.createdAt),
    // The refreshes' budget of the minute: partial, so it holds only the refreshes (a sliver of the table) and the
    // count reads nothing else.
    index("captures_refresh_created_idx").on(t.createdAt).where(sql`${t.trigger} = 'refresh'`),
    check("captures_trigger_check", oneOf(t.trigger, captureTriggerSchema.options)),
    check("captures_status_check", oneOf(t.status, captureStatusSchema.options)),
    check("captures_method_check", sql`${t.method} IS NULL OR ${oneOf(t.method, captureMethodSchema.options)}`),
    check(
      "captures_error_code_check",
      sql`${t.errorCode} IS NULL OR ${oneOf(t.errorCode, captureErrorCodeSchema.options)}`,
    ),
  ],
);

/**
 * A platform asked us to slow down (« Shopify nous demande de ralentir », after a 429/430): one row per platform
 * (`shopify` only today). The import planner spaces the imports while `until` is ahead; the row stays afterwards.
 */
export const crawlSlowdowns = pgTable(
  "crawl_slowdowns",
  {
    platform: text("platform").primaryKey(),
    level: text("level").notNull(),
    /** When the current level began (a 429/430 within 10 min of a `doubled` start does not escalate). */
    since: timestamp("since", { withTimezone: true }).notNull(),
    until: timestamp("until", { withTimezone: true }).notNull(),
    /** Last change of the row (a `nightly` window is extended at most once an hour). */
    updatedAt: updatedAt(),
  },
  (t) => [check("crawl_slowdowns_level_check", oneOf(t.level, shopifySlowdownLevelSchema.options))],
);

/** A signed-in person flags a catalogue article; one report per person and article. */
export const productReports = pgTable(
  "product_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
    /** When the admin closed it (« Masquer du catalogue » or « Garder »); open while null. */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolution: text("resolution"),
  },
  (t) => [
    unique("product_reports_product_user_unique").on(t.productId, t.userId),
    check("product_reports_reason_check", oneOf(t.reason, reportReasonSchema.options)),
    check(
      "product_reports_resolution_check",
      sql`(${t.resolvedAt} IS NULL AND ${t.resolution} IS NULL) OR (${t.resolvedAt} IS NOT NULL AND ${oneOf(t.resolution, reportResolutionSchema.options)})`,
    ),
    // « Signalements » reads the open reports only.
    index("product_reports_open_idx").on(t.productId).where(sql`${t.resolvedAt} IS NULL`),
  ],
);
