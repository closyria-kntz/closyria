import { z } from "zod";
import { LISTING_CONDITIONS } from "./listing-conditions.generated";

// Accords de référencement en ligne (docs/specs/2026-11-14-catalogue-conforme.md §6): a shop gives its listing
// agreement from an invitation link, or asks for it with the public form; the admin keeps its manual checkbox.

export { LISTING_CONDITIONS };

/** How an agreement was given: an invitation link, a request accepted by the admin, or the admin's checkbox. */
export const agreementViaSchema = z.enum(["invitation", "request", "admin"]);
export type AgreementVia = z.infer<typeof agreementViaSchema>;

/** Who ended an agreement: the signer (her private link), the admin (checkbox off), or a newer agreement. */
export const agreementEndedBySchema = z.enum(["signer", "admin", "replaced"]);
export type AgreementEndedBy = z.infer<typeof agreementEndedBySchema>;

export const listingRequestStatusSchema = z.enum(["pending", "accepted", "refused"]);
export type ListingRequestStatus = z.infer<typeof listingRequestStatusSchema>;

/** Invitation and management links: 32 random bytes in base64url, always 43 characters. */
export const LISTING_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const listingTokenSchema = z.string().regex(LISTING_TOKEN_PATTERN);

/** An invitation lives 60 days. */
export const INVITATION_LIFETIME_DAYS = 60;

const isoDate = z.iso.datetime({ offset: true });
const personName = z.string().trim().min(1).max(120);
const personEmail = z.string().trim().toLowerCase().pipe(z.email().max(254));
/** Both boxes must be ticked, and the conditions she read must be the current ones. */
const consent = {
  authorized: z.literal(true),
  accepted: z.literal(true),
  conditionsVersion: z.literal(LISTING_CONDITIONS.version),
};

/** `GET /api/listing/invitations/{token}`: what the invitation page shows. */
export const listingInvitationViewSchema = z.object({
  shop: z.object({ name: z.string(), domain: z.string().nullable() }),
  conditions: z.object({ version: z.string(), sha256: z.string() }),
});
export type ListingInvitationView = z.infer<typeof listingInvitationViewSchema>;

/** `POST /api/listing/invitations/{token}/accept`. */
export const listingAcceptInputSchema = z.object({ name: personName, email: personEmail, ...consent });
export type ListingAcceptInput = z.infer<typeof listingAcceptInputSchema>;

/** The answer of an acceptance: the shop's name and the private management link's token (shown once). */
export const listingAcceptedSchema = z.object({ shopName: z.string(), manageToken: listingTokenSchema });
export type ListingAccepted = z.infer<typeof listingAcceptedSchema>;

/** `GET /api/listing/manage/{token}` and the answer of a withdrawal. */
export const listingManageViewSchema = z.object({
  shopName: z.string(),
  acceptedAt: isoDate,
  withdrawnAt: isoDate.nullable(),
  conditionsVersion: z.string(),
});
export type ListingManageView = z.infer<typeof listingManageViewSchema>;

/** `POST /api/listing/requests`: the public form. `website` is the honeypot, left empty by a person. */
export const listingRequestInputSchema = z.object({
  shopName: z.string().trim().min(1).max(120),
  siteUrl: z
    .string()
    .trim()
    .max(2048)
    .transform((raw) => (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`))
    .pipe(z.url({ protocol: /^https?$/, hostname: z.regexes.domain })),
  name: personName,
  email: personEmail,
  message: z.string().trim().max(2000).optional(),
  website: z.string().max(200).optional(),
  ...consent,
});
export type ListingRequestInput = z.input<typeof listingRequestInputSchema>;

export const listingErrorSchema = z.object({ error: z.string() });

// --- Admin ---

/** One agreement of a shop's history (newest first). */
export const adminAgreementSchema = z.object({
  id: z.uuid(),
  via: agreementViaSchema,
  acceptedAt: isoDate,
  signerName: z.string(),
  signerEmail: z.string(),
  conditionsVersion: z.string(),
  withdrawnAt: isoDate.nullable(),
  withdrawnBy: agreementEndedBySchema.nullable(),
});
export type AdminAgreement = z.infer<typeof adminAgreementSchema>;

/** `GET /api/admin/shops/{id}/agreements`: the open invitation (never its token) and the history. */
export const adminShopAgreementsSchema = z.object({
  invitation: z.object({ createdAt: isoDate, expiresAt: isoDate }).nullable(),
  agreements: z.array(adminAgreementSchema),
});
export type AdminShopAgreements = z.infer<typeof adminShopAgreementsSchema>;

/** `POST /api/admin/shops/{id}/invitations`: the token, given once (only its hash is stored). */
export const adminInvitationCreatedSchema = z.object({ token: listingTokenSchema, expiresAt: isoDate });
export type AdminInvitationCreated = z.infer<typeof adminInvitationCreatedSchema>;

/** A request of « Demandes de référencement ». Refused ones keep no personal data. */
export const adminListingRequestSchema = z.object({
  id: z.uuid(),
  status: listingRequestStatusSchema,
  shopName: z.string(),
  siteUrl: z.string(),
  signerName: z.string().nullable(),
  signerEmail: z.string().nullable(),
  message: z.string().nullable(),
  conditionsVersion: z.string(),
  createdAt: isoDate,
  decidedAt: isoDate.nullable(),
  /** The shop it went to (accepted), or the shop owning its site's domain (pending). */
  shop: z.object({ id: z.uuid(), name: z.string() }).nullable(),
});
export type AdminListingRequest = z.infer<typeof adminListingRequestSchema>;

export const adminListingRequestListSchema = z.object({ requests: z.array(adminListingRequestSchema) });

/** `POST /api/admin/listing-requests/{id}/accept`: the admin checked who the person is. */
export const adminListingRequestAcceptSchema = z.object({ verified: z.literal(true) });

/** The answer of an accepted request: the shop, and the private link the admin sends to the signer. */
export const adminListingRequestAcceptedSchema = z.object({ shopId: z.uuid(), manageToken: listingTokenSchema });

// --- The conditions as the page shows them ---

export type ConditionsBlock =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

/**
 * The conditions' Markdown as blocks: `#` the title, `##` a heading, `- ` list items, other lines joined into
 * paragraphs (a blank line ends one). Nothing else is Markdown in that text: never HTML.
 */
export function conditionsBlocks(markdown: string): ConditionsBlock[] {
  const blocks: ConditionsBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    if (list.length) blocks.push({ kind: "list", items: list });
    paragraph = [];
    list = [];
  };
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (line === "") flush();
    else if (line.startsWith("## ")) {
      flush();
      blocks.push({ kind: "heading", text: line.slice(3) });
    } else if (line.startsWith("# ")) {
      flush();
      blocks.push({ kind: "title", text: line.slice(2) });
    } else if (line.startsWith("- ")) {
      if (paragraph.length) flush();
      list.push(line.slice(2));
    } else if (list.length) {
      // A wrapped list item.
      list[list.length - 1] = `${list[list.length - 1]} ${line}`;
    } else paragraph.push(line);
  }
  flush();
  return blocks;
}
