import {
  carrierSchema,
  inboundEmailStatusSchema,
  MAX_EXTERNAL_REF,
  MAX_ORDER_LINE_COLOR,
  MAX_ORDER_LINE_NAME,
  MAX_ORDER_LINE_QUANTITY,
  MAX_PARCEL_EVENT_LABEL,
  MAX_SHOP_NAME,
  MAX_SIZE_LABEL,
  MAX_TRACKING_NUMBER,
  orderParseMethodSchema,
  orderSourceSchema,
  orderStatusSchema,
  parcelStatusSchema,
} from "@closyria/shared";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { products, shops } from "./catalog";
import { oneOf } from "./helpers";
import { items, profiles } from "./wardrobe";

/**
 * « Après la commande » (docs/specs/2026-11-14-apres-commande.md). Every row belongs to one person: the tables with a
 * `user_id` are registered owned tables (cascade on `user`), the others hang from an order or a parcel (cascade), so
 * deleting an account removes her addresses, e-mails, orders, parcels and their steps.
 */

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const at = (name: string) => timestamp(name, { withTimezone: true });
const owner = () =>
  text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" });
const lengthBetween = (column: AnyPgColumn, max: number) =>
  sql`char_length(${column}) BETWEEN 1 AND ${sql.raw(String(max))}`;
const atMost = (column: AnyPgColumn, max: number) =>
  sql`${column} IS NULL OR char_length(${column}) <= ${sql.raw(String(max))}`;

/**
 * Her order addresses (`{local_part}@commandes.closyria.com`), accounts only. At most one active; « Changer
 * d'adresse » deactivates it and adds another, the old one stops working (its e-mails are ignored).
 */
export const orderInboxes = pgTable(
  "order_inboxes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    localPart: text("local_part").notNull().unique(),
    active: boolean("active").notNull().default(true),
    /**
     * Gmail's forwarding confirmation code, from its « Confirmation de transfert » e-mail when the address that asked
     * is hers; shown for 24 hours after `gmail_code_at` (« Mes commandes par e-mail »).
     */
    gmailCode: text("gmail_code"),
    gmailCodeAt: at("gmail_code_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("order_inboxes_user_id_idx").on(t.userId),
    check("order_inboxes_gmail_code_check", sql`${t.gmailCode} IS NULL OR ${t.gmailCode} ~ '^[0-9]{6,12}$'`),
    uniqueIndex("order_inboxes_user_id_active_idx").on(t.userId).where(sql`${t.active}`),
    check("order_inboxes_local_part_check", sql`${t.localPart} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

/**
 * E-mails received on one of her addresses. `user_id` is set only once the sender was accepted (her verified address,
 * authentication passed); an ignored one keeps only the inbox (deleted with it). The raw message lives in private
 * storage (`raw_object_key`) until `purge_after` (30 days); then `inboundEmailPurge` decides: ignored rows, and failed
 * ones no order points to, are deleted; the others lose their raw message.
 */
export const inboundEmails = pgTable(
  "inbound_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    inboxId: uuid("inbox_id")
      .notNull()
      .references(() => orderInboxes.id, { onDelete: "cascade" }),
    receivedAt: at("received_at").defaultNow().notNull(),
    /** Postfix's queue id: with the address (one recipient per delivery), a retry or a replay files nothing twice. */
    queueId: text("queue_id").notNull(),
    fromAddress: text("from_address").notNull(),
    /** The effective sender was hers and authenticated (inbound/sender.ts in the API). */
    authOk: boolean("auth_ok").notNull(),
    status: text("status").notNull(),
    rawObjectKey: text("raw_object_key"),
    purgeAfter: at("purge_after").notNull(),
  },
  (t) => [
    index("inbound_emails_inbox_id_idx").on(t.inboxId),
    uniqueIndex("inbound_emails_inbox_id_queue_id_idx").on(t.inboxId, t.queueId),
    index("inbound_emails_user_id_idx").on(t.userId),
    index("inbound_emails_purge_after_idx").on(t.purgeAfter),
    check("inbound_emails_status_check", oneOf(t.status, inboundEmailStatusSchema.options)),
    check("inbound_emails_from_check", sql`char_length(${t.fromAddress}) BETWEEN 1 AND 320`),
  ],
);

/** An order of hers: a draft to validate (read from an e-mail), confirmed, or dismissed (« Ce n'est pas une commande »). */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    /** No action, like `items.profile_id`: deleting a profile moves its orders to another one first. */
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id),
    shopId: uuid("shop_id").references(() => shops.id, { onDelete: "set null" }),
    /**
     * The shop name she typed (« Corriger », manual entry) when it matches no shop: never a shop created from a typed
     * name. Null when the shop is known or unnamed.
     */
    shopName: text("shop_name"),
    /** The shop's order number (« #1042 »): with the shop, finds the order a second e-mail completes. */
    externalRef: text("external_ref"),
    orderedAt: at("ordered_at"),
    status: text("status").notNull().default("draft"),
    source: text("source").notNull(),
    parseMethod: text("parse_method").notNull(),
    inboundEmailId: uuid("inbound_email_id").references(() => inboundEmails.id, { onDelete: "set null" }),
    /** When she validated it (« C'est bon », a manual entry, a pasted number): the J+10 question's last resort. */
    confirmedAt: at("confirmed_at"),
    /**
     * « Tu as reçu ta commande {boutique} ? » (Task 6): asked at 10 days without news, her « Pas encore », asked again
     * at 20 days after it. Each is set once; a third question is never asked.
     */
    receivedAskedAt: at("received_asked_at"),
    receivedNotYetAt: at("received_not_yet_at"),
    receivedAskedAgainAt: at("received_asked_again_at"),
    createdAt: createdAt(),
    updatedAt: at("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("orders_user_id_status_idx").on(t.userId, t.status),
    index("orders_user_id_shop_ref_idx").on(t.userId, t.shopId, t.externalRef),
    index("orders_profile_id_idx").on(t.profileId),
    index("orders_inbound_email_id_idx").on(t.inboundEmailId),
    check("orders_status_check", oneOf(t.status, orderStatusSchema.options)),
    check("orders_source_check", oneOf(t.source, orderSourceSchema.options)),
    check("orders_parse_method_check", oneOf(t.parseMethod, orderParseMethodSchema.options)),
    check("orders_external_ref_check", atMost(t.externalRef, MAX_EXTERNAL_REF)),
    check(
      "orders_shop_name_check",
      sql`${t.shopName} IS NULL OR char_length(${t.shopName}) BETWEEN 1 AND ${sql.raw(String(MAX_SHOP_NAME))}`,
    ),
  ],
);

/** An article of an order; `item_id` is the item it was linked to or created as on « C'est bon ». */
export const orderLines = pgTable(
  "order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    sizeLabel: text("size_label"),
    color: text("color"),
    quantity: integer("quantity").notNull().default(1),
    /** One piece's price (an e-mail's line total is divided by its quantity). */
    priceCents: integer("price_cents"),
    currency: text("currency"),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    index("order_lines_order_id_idx").on(t.orderId),
    index("order_lines_item_id_idx").on(t.itemId),
    check("order_lines_name_check", lengthBetween(t.name, MAX_ORDER_LINE_NAME)),
    check("order_lines_size_label_check", atMost(t.sizeLabel, MAX_SIZE_LABEL)),
    check("order_lines_color_check", atMost(t.color, MAX_ORDER_LINE_COLOR)),
    check("order_lines_quantity_check", sql`${t.quantity} BETWEEN 1 AND ${sql.raw(String(MAX_ORDER_LINE_QUANTITY))}`),
    check("order_lines_price_check", sql`${t.priceCents} IS NULL OR ${t.priceCents} >= 0`),
    check("order_lines_currency_check", sql`${t.currency} IS NULL OR char_length(${t.currency}) = 3`),
  ],
);

/**
 * A parcel of an order, followed until delivered or `check_until` (30 days). `carrier` null: not recognised, she can
 * pick it. `next_check_at` null: no more checks.
 */
export const parcels = pgTable(
  "parcels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    carrier: text("carrier"),
    trackingNumber: text("tracking_number").notNull(),
    status: text("status").notNull().default("pending"),
    lastEventAt: at("last_event_at"),
    estimatedAt: at("estimated_at"),
    deliveredAt: at("delivered_at"),
    nextCheckAt: at("next_check_at"),
    checkUntil: at("check_until").notNull(),
    /**
     * Checks in a row that failed (carrier down, timeout, unreadable answer); reset by an answer. At
     * `PARCEL_MAX_CHECK_FAILURES` the parcel turns `unknown`, never a visible error (RF 4).
     */
    checkFailures: integer("check_failures").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("parcels_order_id_tracking_number_idx").on(t.orderId, t.trackingNumber),
    index("parcels_next_check_at_idx").on(t.nextCheckAt).where(sql`${t.nextCheckAt} IS NOT NULL`),
    check("parcels_carrier_check", sql`${t.carrier} IS NULL OR ${oneOf(t.carrier, carrierSchema.options)}`),
    check("parcels_status_check", oneOf(t.status, parcelStatusSchema.options)),
    check("parcels_check_failures_check", sql`${t.checkFailures} >= 0`),
    check(
      "parcels_tracking_number_check",
      sql`${t.trackingNumber} ~ ${sql.raw(`'^[0-9A-Z]{1,${MAX_TRACKING_NUMBER}}$'`)}`,
    ),
  ],
);

/** The carrier's steps of a parcel (« Pris en charge », « En cours de livraison »…), one row per step read. */
export const parcelEvents = pgTable(
  "parcel_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parcelId: uuid("parcel_id")
      .notNull()
      .references(() => parcels.id, { onDelete: "cascade" }),
    at: at("at").notNull(),
    status: text("status").notNull(),
    label: text("label").notNull(),
  },
  (t) => [
    // The same step read twice (every check reads the whole history) is kept once.
    uniqueIndex("parcel_events_parcel_id_at_label_idx").on(t.parcelId, t.at, t.label),
    check("parcel_events_status_check", oneOf(t.status, parcelStatusSchema.options)),
    check("parcel_events_label_check", lengthBetween(t.label, MAX_PARCEL_EVENT_LABEL)),
  ],
);
