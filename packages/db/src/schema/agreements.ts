import { agreementEndedBySchema, agreementViaSchema, listingRequestStatusSchema } from "@closyria/shared";
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { shops } from "./catalog";
import { oneOf } from "./helpers";

// Accords de référencement en ligne (docs/specs/2026-11-14-catalogue-conforme.md §6). Tokens are never stored: only
// their SHA-256 (hex). Nothing here keeps the signer's IP address (spec V1 §9, §10).

/**
 * A shop's listing agreement: who gave it, when, on which conditions (version and SHA-256 of the exact text shown).
 * At most one is in force per shop (`withdrawn_at` null); while it is, `shops.listing_agreement_at` is set. Kept after
 * withdrawal as the history of the shop.
 */
export const shopAgreements = pgTable(
  "shop_agreements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    signerName: text("signer_name").notNull(),
    signerEmail: text("signer_email").notNull(),
    conditionsVersion: text("conditions_version").notNull(),
    conditionsSha256: text("conditions_sha256").notNull(),
    via: text("via").notNull(),
    /** SHA-256 of the private management link's token (withdrawal); null for the admin's checkbox. */
    manageTokenHash: text("manage_token_hash").unique(),
    /** The admin who ticked the box or accepted the request; null for an invitation. */
    adminId: text("admin_id").references(() => user.id, { onDelete: "set null" }),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawnBy: text("withdrawn_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("shop_agreements_via_check", oneOf(t.via, agreementViaSchema.options)),
    check(
      "shop_agreements_withdrawn_check",
      sql`(${t.withdrawnAt} IS NULL AND ${t.withdrawnBy} IS NULL) OR (${t.withdrawnAt} IS NOT NULL AND ${oneOf(t.withdrawnBy, agreementEndedBySchema.options)})`,
    ),
    uniqueIndex("shop_agreements_in_force_idx").on(t.shopId).where(sql`${t.withdrawnAt} IS NULL`),
    index("shop_agreements_shop_idx").on(t.shopId, t.acceptedAt),
  ],
);

/**
 * An invitation link sent by the admin. Open while neither revoked nor accepted, until `expires_at` (60 days); at
 * most one open per shop (a new one revokes the previous). Accepted once only.
 */
export const shopInvitations = pgTable(
  "shop_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    agreementId: uuid("agreement_id").references(() => shopAgreements.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("shop_invitations_open_idx")
      .on(t.shopId)
      .where(sql`${t.revokedAt} IS NULL AND ${t.acceptedAt} IS NULL`),
  ],
);

/**
 * « Référencer ma boutique »: a request sent from the public form, decided by the admin. A refused request keeps no
 * personal data (name, e-mail and message are erased).
 */
export const listingRequests = pgTable(
  "listing_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: text("status").notNull().default("pending"),
    shopName: text("shop_name").notNull(),
    siteUrl: text("site_url").notNull(),
    signerName: text("signer_name"),
    signerEmail: text("signer_email"),
    message: text("message"),
    conditionsVersion: text("conditions_version").notNull(),
    conditionsSha256: text("conditions_sha256").notNull(),
    shopId: uuid("shop_id").references(() => shops.id, { onDelete: "set null" }),
    agreementId: uuid("agreement_id").references(() => shopAgreements.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("listing_requests_status_check", oneOf(t.status, listingRequestStatusSchema.options)),
    check(
      "listing_requests_person_check",
      sql`${t.status} = 'refused' OR (${t.signerName} IS NOT NULL AND ${t.signerEmail} IS NOT NULL)`,
    ),
    index("listing_requests_status_idx").on(t.status, t.createdAt),
  ],
);
