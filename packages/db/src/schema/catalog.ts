import {
  captureErrorCodeSchema,
  captureMethodSchema,
  captureModeSchema,
  captureStatusSchema,
  captureTriggerSchema,
  listingKindSchema,
  platformSchema,
  productCaptureStatusSchema,
  productSourceSchema,
  shopStatusSchema,
} from "@closyria/shared";
import { type SQL, sql } from "drizzle-orm";
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

/** `column IN ('a', 'b')` built from a closed value set shared with the API, so the lists never drift. */
const oneOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} IN (${sql.join(
    values.map((v) => sql.raw(`'${v}'`)),
    sql.raw(", "),
  )})`;

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
    name: text("name").notNull(),
    brand: text("brand"),
    description: text("description"),
    currency: text("currency").notNull(),
    priceCents: integer("price_cents").notNull(),
    compareAtCents: integer("compare_at_cents"),
    source: text("source").notNull().default("captured"),
    captureStatus: text("capture_status").notNull().default("pending"),
    lastCapturedAt: timestamp("last_captured_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("products_shop_id_idx").on(t.shopId),
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
