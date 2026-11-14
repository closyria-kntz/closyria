import {
  LISTING_TOKEN_PATTERN,
  type ListingAccepted,
  type ListingInvitationView,
  type ListingManageView,
  listingAcceptedSchema,
  listingAcceptInputSchema,
  listingInvitationViewSchema,
  listingManageViewSchema,
  listingRequestInputSchema,
} from "@closyria/shared";
import { type AdminResult, fetchAdminJson, type InternalApi } from "./admin-api";

// Accords de référencement en ligne: the public pages' calls. The first paint reads through the internal API (server,
// no cookie: the shop's representative needs no account); the form posts from her browser, same origin.

export const INVITATION_PAGE = "/referencement";
export const MANAGE_PAGE = "/referencement/gerer";
export const REQUEST_PAGE = "/referencer-ma-boutique";

export const invitationUrl = (origin: string, token: string) => `${origin}${INVITATION_PAGE}/${token}`;
export const manageUrl = (origin: string, token: string) => `${origin}${MANAGE_PAGE}/${token}`;

/** A token of the right shape; anything else is an invalid link and never reaches the API path. */
export const isListingToken = (token: string) => LISTING_TOKEN_PATTERN.test(token);

export async function fetchInvitation(api: InternalApi, token: string): Promise<AdminResult<ListingInvitationView>> {
  if (!isListingToken(token)) return { ok: false, status: 404 };
  return fetchAdminJson({ ...api, cookie: "" }, `/api/listing/invitations/${token}`, listingInvitationViewSchema);
}

export async function fetchManage(api: InternalApi, token: string): Promise<AdminResult<ListingManageView>> {
  if (!isListingToken(token)) return { ok: false, status: 404 };
  return fetchAdminJson({ ...api, cookie: "" }, `/api/listing/manage/${token}`, listingManageViewSchema);
}

export type ConsentField = "name" | "email" | "authorized" | "accepted";
export type RequestField = ConsentField | "shopName" | "siteUrl";
export type SendError = "invalid" | "tooMany" | "failed";

/** The fields a schema refuses, in the form's order (the first one gets the focus). */
function fieldsOf<F extends string>(issues: readonly { path: readonly PropertyKey[] }[], order: readonly F[]): F[] {
  const bad = new Set(issues.map((i) => String(i.path[0])));
  return order.filter((f) => bad.has(f));
}

const CONSENT_ORDER = ["name", "email", "authorized", "accepted"] as const;
const REQUEST_ORDER = ["shopName", "siteUrl", "name", "email", "authorized", "accepted"] as const;

export type ConsentInput = { name: string; email: string; authorized: boolean; accepted: boolean; version: string };

export function acceptBody(input: ConsentInput) {
  return {
    name: input.name,
    email: input.email,
    authorized: input.authorized,
    accepted: input.accepted,
    conditionsVersion: input.version,
  };
}

/** The fields to fix before sending an acceptance (none: it can go). */
export function acceptErrors(input: ConsentInput): ConsentField[] {
  const parsed = listingAcceptInputSchema.safeParse(acceptBody(input));
  return parsed.success ? [] : fieldsOf(parsed.error.issues, CONSENT_ORDER);
}

export type RequestFormInput = ConsentInput & { shopName: string; siteUrl: string; message: string; website: string };

export function requestBody(input: RequestFormInput) {
  return {
    ...acceptBody(input),
    shopName: input.shopName,
    siteUrl: input.siteUrl,
    ...(input.message.trim() ? { message: input.message } : {}),
    ...(input.website ? { website: input.website } : {}),
  };
}

export function requestErrors(input: RequestFormInput): RequestField[] {
  const parsed = listingRequestInputSchema.safeParse(requestBody(input));
  return parsed.success ? [] : fieldsOf(parsed.error.issues, REQUEST_ORDER);
}

const sendErrorOf = (status: number): SendError => (status === 404 ? "invalid" : status === 429 ? "tooMany" : "failed");

async function post(path: string, body: unknown, fetcher: typeof fetch): Promise<Response | null> {
  try {
    return await fetcher(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? null : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

export async function acceptInvitation(
  token: string,
  input: ConsentInput,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true; data: ListingAccepted } | { ok: false; error: SendError }> {
  const res = await post(`/api/listing/invitations/${token}/accept`, acceptBody(input), fetcher);
  if (!res) return { ok: false, error: "failed" };
  if (res.status !== 201) return { ok: false, error: sendErrorOf(res.status) };
  const parsed = listingAcceptedSchema.safeParse(await res.json().catch(() => null));
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: "failed" };
}

export async function withdrawShop(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true; data: ListingManageView } | { ok: false; error: SendError }> {
  const res = await post(`/api/listing/manage/${token}/withdraw`, undefined, fetcher);
  if (!res) return { ok: false, error: "failed" };
  if (res.status !== 200) return { ok: false, error: sendErrorOf(res.status) };
  const parsed = listingManageViewSchema.safeParse(await res.json().catch(() => null));
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: "failed" };
}

export async function sendListingRequest(
  input: RequestFormInput,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: SendError }> {
  const res = await post("/api/listing/requests", requestBody(input), fetcher);
  if (!res) return { ok: false, error: "failed" };
  if (res.status === 202) return { ok: true };
  return { ok: false, error: res.status === 429 ? "tooMany" : "failed" };
}
