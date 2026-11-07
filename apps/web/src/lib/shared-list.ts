import {
  type OpinionDelete,
  type OpinionInput,
  type OpinionView,
  opinionViewSchema,
  type SharedWishlistView,
  sharedWishlistViewSchema,
} from "@closyria/shared";
import { z } from "zod";
import { type AdminResult, fetchAdminJson, type InternalApi } from "./admin-api";

// The public page's calls: its first paint reads the shared list through the internal API (server); a friend's
// opinions are written from her browser, same origin, without credentials.

/** A share token is base64url; anything else is an unknown list and never reaches the API path. */
const TOKEN = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * The shared list for a token (G4 content only). The page is public: the visitor's cookies are not sent. A stopped,
 * unknown or malformed token is `{ ok: false, status: 404 }`; a server error throws.
 */
export async function fetchSharedList(api: InternalApi, token: string): Promise<AdminResult<SharedWishlistView>> {
  if (!TOKEN.test(token)) return { ok: false, status: 404 };
  return fetchAdminJson({ ...api, cookie: "" }, `/api/shared/${token}`, sharedWishlistViewSchema);
}

/** The list as the friend's browser reads it again after a change; null when the link stopped working. */
export async function fetchSharedView(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<SharedWishlistView | null> {
  if (!TOKEN.test(token)) return null;
  const res = await fetcher(`/api/shared/${token}`, { credentials: "omit", cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`/api/shared answered ${res.status}`);
  return sharedWishlistViewSchema.parse(await res.json());
}

export const opinionErrorCodes = [
  "not_found",
  "opinions_closed",
  "web_address",
  "name_taken",
  "rate_limited",
  "forbidden",
  "failed",
] as const;
export type OpinionError = (typeof opinionErrorCodes)[number];
const errorSchema = z.object({ error: z.string() });

async function opinionCall(
  fetcher: typeof fetch,
  token: string,
  itemId: string,
  method: "PUT" | "DELETE",
  body: OpinionInput | OpinionDelete,
): Promise<Response | OpinionError> {
  if (!TOKEN.test(token)) return "not_found";
  try {
    return await fetcher(`/api/shared/${token}/items/${encodeURIComponent(itemId)}/opinion`, {
      method,
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return "failed";
  }
}

async function errorOf(res: Response): Promise<OpinionError> {
  const parsed = errorSchema.safeParse(await res.json().catch(() => null));
  const code = parsed.success ? parsed.data.error : "";
  return (opinionErrorCodes as readonly string[]).includes(code) ? (code as OpinionError) : "failed";
}

/** Gives or replaces her opinion on one item of the list. */
export async function putOpinion(
  token: string,
  itemId: string,
  input: OpinionInput,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true; opinion: OpinionView } | { ok: false; error: OpinionError }> {
  const res = await opinionCall(fetcher, token, itemId, "PUT", input);
  if (typeof res === "string") return { ok: false, error: res };
  if (!res.ok) return { ok: false, error: await errorOf(res) };
  const parsed = opinionViewSchema.safeParse(await res.json().catch(() => null));
  return parsed.success ? { ok: true, opinion: parsed.data } : { ok: false, error: "failed" };
}

/** Erases her opinion on one item (only with the device key that wrote it). */
export async function deleteOpinion(
  token: string,
  itemId: string,
  input: OpinionDelete,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: OpinionError }> {
  const res = await opinionCall(fetcher, token, itemId, "DELETE", input);
  if (typeof res === "string") return { ok: false, error: res };
  return res.ok ? { ok: true } : { ok: false, error: await errorOf(res) };
}
