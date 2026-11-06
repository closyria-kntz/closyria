import { type SharedWishlistView, sharedWishlistViewSchema } from "@closyria/shared";
import { type AdminResult, fetchAdminJson, type InternalApi } from "./admin-api";

// Server only: the public page reads the shared list through the internal API.

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
