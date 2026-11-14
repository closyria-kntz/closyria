import {
  alertKindSchema,
  alertStatusSchema,
  DEFAULT_DIGEST_HOUR,
  DIGEST_HOUR_MAX,
  DIGEST_HOUR_MIN,
  ITEM_ALERT_KINDS,
  MAX_SALE_PERIOD_NAME,
} from "@closyria/shared";
import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { products, shops } from "./catalog";
import { oneOf } from "./helpers";
import { items, profiles } from "./wardrobe";

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const owner = () =>
  text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" });

/** One browser (device) that receives her notifications. Removed when the browser answers 404/410. */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    /** The push service's address: one row per endpoint (a re-subscription updates it). */
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    /** Last send the push service accepted. */
    lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
  },
  (t) => [index("push_subscriptions_user_id_idx").on(t.userId)],
);

/** Her notification settings; without a row, `DEFAULT_ALERT_SETTINGS`. */
export const alertSettings = pgTable(
  "alert_settings",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    sizeBack: boolean("size_back").notNull().default(true),
    targetPrice: boolean("target_price").notNull().default(true),
    digest: boolean("digest").notNull().default(true),
    /** Hour of the daily digest, Europe/Paris. */
    digestHour: integer("digest_hour").notNull().default(DEFAULT_DIGEST_HOUR),
  },
  (t) => [
    check(
      "alert_settings_digest_hour_check",
      sql`${t.digestHour} BETWEEN ${sql.raw(String(DIGEST_HOUR_MIN))} AND ${sql.raw(String(DIGEST_HOUR_MAX))}`,
    ),
  ],
);

/** Winter and summer sales, entered in admin; first and last day included. */
export const salePeriods = pgTable(
  "sale_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
  },
  (t) => [
    check(
      "sale_periods_name_check",
      sql`char_length(${t.name}) BETWEEN 1 AND ${sql.raw(String(MAX_SALE_PERIOD_NAME))}`,
    ),
    check("sale_periods_dates_check", sql`${t.endsOn} >= ${t.startsOn}`),
  ],
);

/**
 * Something to tell her, born from a capture (size back, target price, drop), an import (shop promo) or the sales
 * calendar. Item kinds name the item (and its profile and product); the others do not.
 */
export const alertEvents = pgTable(
  "alert_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    profileId: uuid("profile_id").references(() => profiles.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").references(() => items.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** size_back: the shop's label back in stock. */
    sizeLabel: text("size_label"),
    /** target_price, price_drop: the new price and the one before. */
    priceCents: integer("price_cents"),
    previousCents: integer("previous_cents"),
    shopId: uuid("shop_id").references(() => shops.id, { onDelete: "cascade" }),
    salePeriodId: uuid("sale_period_id").references(() => salePeriods.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    /** Immediate kinds: not before this (quiet hours). */
    sendAfter: timestamp("send_after", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** Digest kinds: the Paris day of the digest it belongs to. */
    digestOn: date("digest_on"),
    readAt: timestamp("read_at", { withTimezone: true }),
    status: text("status").notNull().default("pending"),
  },
  (t) => [
    index("alert_events_user_created_idx").on(t.userId, t.createdAt.desc()),
    index("alert_events_item_kind_idx").on(t.itemId, t.kind, t.createdAt),
    index("alert_events_profile_id_idx").on(t.profileId),
    index("alert_events_shop_id_idx").on(t.shopId),
    index("alert_events_sale_period_id_idx").on(t.salePeriodId),
    index("alert_events_digest_idx").on(t.userId, t.digestOn).where(sql`${t.digestOn} IS NOT NULL`),
    check("alert_events_kind_check", oneOf(t.kind, alertKindSchema.options)),
    check("alert_events_status_check", oneOf(t.status, alertStatusSchema.options)),
    check(
      "alert_events_item_check",
      sql`NOT (${oneOf(t.kind, ITEM_ALERT_KINDS)}) OR (${t.itemId} IS NOT NULL AND ${t.profileId} IS NOT NULL AND ${t.productId} IS NOT NULL)`,
    ),
    check(
      "alert_events_cents_check",
      sql`(${t.priceCents} IS NULL OR ${t.priceCents} >= 0) AND (${t.previousCents} IS NULL OR ${t.previousCents} >= 0)`,
    ),
  ],
);

/** One row per push attempt, for the dashboard (sent / failed over 7 days). */
export const alertSends = pgTable(
  "alert_sends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
    ok: boolean("ok").notNull(),
  },
  (t) => [index("alert_sends_sent_at_idx").on(t.sentAt), index("alert_sends_user_sent_idx").on(t.userId, t.sentAt)],
);
