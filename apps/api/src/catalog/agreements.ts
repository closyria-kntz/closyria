import { createHash, randomBytes } from "node:crypto";
import { and, type Database, desc, eq, gt, isNull, schema, sql } from "@closyria/db";
import {
  type AdminAgreement,
  type AgreementEndedBy,
  type AgreementVia,
  INVITATION_LIFETIME_DAYS,
  LISTING_CONDITIONS,
} from "@closyria/shared";

// Accords de référencement en ligne (docs/specs/2026-11-14-catalogue-conforme.md §6). The partner status itself stays
// `shops.listing_agreement_at` (`partnerShop`): these helpers keep it in step with the agreement in force.

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const DAY_MS = 24 * 60 * 60 * 1000;

/** SHA-256 of a link token, hex: the only thing stored. Lookup is by hash (no comparison to make in constant time). */
export function hashListingToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A new unguessable link token (32 random bytes, base64url: 43 characters) and the hash to store. */
export function newListingToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashListingToken(token) };
}

export const invitationExpiry = (from: Date) => new Date(from.getTime() + INVITATION_LIFETIME_DAYS * DAY_MS);

/** The shop's main domain (the shortest), as the directory shows it; null without one. */
export async function mainDomain(db: Database | Tx, shopId: string): Promise<string | null> {
  const { rows } = await db.execute<{ domain: string }>(sql`
    select domain from shop_domains where shop_id = ${shopId} order by length(domain), domain limit 1`);
  return rows[0]?.domain ?? null;
}

/** The invitation of a token if it can still be accepted: neither revoked nor accepted, not expired, shop not merged. */
export async function openInvitation(db: Database | Tx, token: string, at: Date, lock = false) {
  const query = db
    .select({ invitation: schema.shopInvitations, shop: schema.shops })
    .from(schema.shopInvitations)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.shopInvitations.shopId))
    .where(
      and(
        eq(schema.shopInvitations.tokenHash, hashListingToken(token)),
        isNull(schema.shopInvitations.revokedAt),
        isNull(schema.shopInvitations.acceptedAt),
        gt(schema.shopInvitations.expiresAt, at),
        isNull(schema.shops.mergedIntoId),
      ),
    );
  const [row] = await (lock ? query.for("update") : query);
  return row ?? null;
}

/** Revokes the shop's open invitation, if any. True when one was revoked. */
export async function revokeInvitations(db: Database | Tx, shopId: string, at: Date): Promise<boolean> {
  const revoked = await db
    .update(schema.shopInvitations)
    .set({ revokedAt: at })
    .where(
      and(
        eq(schema.shopInvitations.shopId, shopId),
        isNull(schema.shopInvitations.revokedAt),
        isNull(schema.shopInvitations.acceptedAt),
      ),
    )
    .returning({ id: schema.shopInvitations.id });
  return revoked.length > 0;
}

/** A new invitation for the shop (the open one, if any, is revoked): the token is returned once, never stored. */
export async function createInvitation(db: Database, shopId: string, adminId: string | null, at: Date) {
  const { token, hash } = newListingToken();
  const expiresAt = invitationExpiry(at);
  await db.transaction(async (tx) => {
    await revokeInvitations(tx, shopId, at);
    await tx
      .insert(schema.shopInvitations)
      .values({ shopId, tokenHash: hash, expiresAt, createdBy: adminId, createdAt: at });
  });
  return { token, expiresAt };
}

/** Ends the agreement in force of the shop (if any) and takes the partner status off. */
export async function endAgreement(tx: Tx, shopId: string, by: AgreementEndedBy, at: Date): Promise<void> {
  await tx
    .update(schema.shopAgreements)
    .set({ withdrawnAt: at, withdrawnBy: by })
    .where(and(eq(schema.shopAgreements.shopId, shopId), isNull(schema.shopAgreements.withdrawnAt)));
  if (by !== "replaced") {
    await tx.update(schema.shops).set({ listingAgreementAt: null, updatedAt: at }).where(eq(schema.shops.id, shopId));
  }
}

export type NewAgreement = {
  shopId: string;
  via: AgreementVia;
  signerName: string;
  signerEmail: string;
  acceptedAt: Date;
  adminId?: string | null;
  /** The conditions she accepted: the current ones unless given (a request keeps what was shown to her). */
  conditions?: { version: string; sha256: string };
  /** A private management link (withdrawal) for the signer: invitations and requests, never the admin's checkbox. */
  withManageLink: boolean;
};

/**
 * Records an agreement, the shop's only one in force (a previous one ends as `replaced`), sets the partner status
 * and leaves an audit-like trace (no personal data in it). Returns the management token, given once.
 */
export async function recordAgreement(
  tx: Tx,
  input: NewAgreement,
): Promise<{ id: string; manageToken: string | null }> {
  await endAgreement(tx, input.shopId, "replaced", input.acceptedAt);
  const manage = input.withManageLink ? newListingToken() : null;
  const conditions = input.conditions ?? LISTING_CONDITIONS;
  const [row] = await tx
    .insert(schema.shopAgreements)
    .values({
      shopId: input.shopId,
      via: input.via,
      acceptedAt: input.acceptedAt,
      signerName: input.signerName,
      signerEmail: input.signerEmail,
      conditionsVersion: conditions.version,
      conditionsSha256: conditions.sha256,
      manageTokenHash: manage?.hash ?? null,
      adminId: input.adminId ?? null,
      createdAt: input.acceptedAt,
    })
    .returning({ id: schema.shopAgreements.id });
  if (!row) throw new Error("agreement not recorded");
  await tx
    .update(schema.shops)
    .set({ listingAgreementAt: input.acceptedAt, updatedAt: input.acceptedAt })
    .where(eq(schema.shops.id, input.shopId));
  return { id: row.id, manageToken: manage?.token ?? null };
}

/**
 * The trace of an agreement given or withdrawn by the shop itself (no admin): a row of the admin journal without an
 * admin, so the founder sees it with the others. Never the signer's name or e-mail.
 */
export async function traceAgreement(
  tx: Tx,
  action: "shop.agreement.accept" | "shop.agreement.withdraw",
  shopId: string,
  details: Record<string, string>,
  at: Date,
): Promise<void> {
  await tx
    .insert(schema.adminAuditLog)
    .values({ adminId: null, action, target: `shop:${shopId}`, details, createdAt: at });
}

/**
 * The admin's checkbox (« Accord de référencement » in the shop's settings): ticking it records an agreement given by
 * the admin (she is the signer), changing its day moves an agreement of hers, unticking it ends the one in force.
 * Called in the PATCH's transaction, before the shop row is written (the PATCH writes `listing_agreement_at`).
 */
export async function syncAdminCheckbox(
  tx: Tx,
  shopId: string,
  day: Date | null,
  admin: { id: string; name: string; email: string },
  at: Date,
): Promise<void> {
  const [inForce] = await tx
    .select()
    .from(schema.shopAgreements)
    .where(and(eq(schema.shopAgreements.shopId, shopId), isNull(schema.shopAgreements.withdrawnAt)));
  if (day === null) {
    if (inForce) await endAgreement(tx, shopId, "admin", at);
    return;
  }
  if (!inForce) {
    await recordAgreement(tx, {
      shopId,
      via: "admin",
      signerName: admin.name || admin.email,
      signerEmail: admin.email,
      acceptedAt: day,
      adminId: admin.id,
      withManageLink: false,
    });
  } else if (inForce.via === "admin" && inForce.acceptedAt.getTime() !== day.getTime()) {
    await tx.update(schema.shopAgreements).set({ acceptedAt: day }).where(eq(schema.shopAgreements.id, inForce.id));
  }
}

/** The shop's agreements, newest first. */
export async function agreementsOf(db: Database, shopId: string): Promise<AdminAgreement[]> {
  const rows = await db
    .select()
    .from(schema.shopAgreements)
    .where(eq(schema.shopAgreements.shopId, shopId))
    .orderBy(desc(schema.shopAgreements.createdAt), desc(schema.shopAgreements.acceptedAt));
  return rows.map((r) => ({
    id: r.id,
    via: r.via as AgreementVia,
    acceptedAt: r.acceptedAt.toISOString(),
    signerName: r.signerName,
    signerEmail: r.signerEmail,
    conditionsVersion: r.conditionsVersion,
    withdrawnAt: r.withdrawnAt?.toISOString() ?? null,
    withdrawnBy: (r.withdrawnBy as AgreementEndedBy | null) ?? null,
  }));
}
