import { createAuthClient, ensureSession } from "@closyria/auth/client";
import {
  type FacetsView,
  facetsViewSchema,
  type ItemBulk,
  type ItemCreate,
  type ItemPage,
  type ItemPatch,
  type ItemStageInput,
  type ItemView,
  itemMutationResultSchema,
  itemPageSchema,
  mediaErrorCodes,
  mutationResultSchema,
  type ProfileInput,
  type ProfilePatch,
  photoImportAcceptedSchema,
  photoImportViewSchema,
  profileListSchema,
  profileViewSchema,
  type RecentList,
  type ReferenceView,
  recentListSchema,
  referenceViewSchema,
  shareResultSchema,
  type TagPatch,
  type TagView,
  tagListSchema,
  tagViewSchema,
  type UndoPayload,
  type WishlistView,
  wardrobeErrorCodes,
  wishlistListSchema,
  wishlistViewSchema,
} from "@closyria/shared";
import type { ZodType } from "zod";
import type { ClientDeps } from "./catalog-client";

/** Browser calls to `/api/me/…`; every answer is validated with the shared schemas. */
const defaultDeps: ClientDeps = {
  fetch: (...args) => fetch(...args),
  ensure: () => ensureSession(createAuthClient(window.location.origin)),
};

const KNOWN_ERRORS: readonly string[] = [...wardrobeErrorCodes, ...mediaErrorCodes];
export type ClientError = (typeof wardrobeErrorCodes)[number] | (typeof mediaErrorCodes)[number] | "failed";
export type Result<T> = ({ ok: true } & T) | { ok: false; error: ClientError };

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Runs a mutation: a session first, then the call; an API error code is kept, anything else is « failed ». */
async function call<T extends object>(
  deps: ClientDeps,
  path: string,
  init: RequestInit,
  schema: ZodType<T>,
  okStatuses: readonly number[] = [200, 201],
): Promise<Result<T & { status: number }>> {
  try {
    await deps.ensure();
    const response = await deps.fetch(path, init);
    if (okStatuses.includes(response.status)) {
      const parsed = schema.safeParse(await response.json());
      return parsed.success ? { ok: true, ...parsed.data, status: response.status } : { ok: false, error: "failed" };
    }
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    if (typeof body?.error === "string" && KNOWN_ERRORS.includes(body.error)) {
      return { ok: false, error: body.error as ClientError };
    }
  } catch {
    // Falls through to the generic error.
  }
  return { ok: false, error: "failed" };
}

function mutation(deps: ClientDeps, path: string, init: RequestInit, okStatuses?: readonly number[]) {
  return call(deps, path, init, itemMutationResultSchema, okStatuses);
}

/** « Garder » a product. `created: false`: she already kept it, and this is her existing item, unchanged. */
export async function createItem(input: ItemCreate, deps: ClientDeps = defaultDeps) {
  const result = await mutation(deps, "/api/me/items", jsonInit("POST", input));
  return result.ok ? { ...result, created: result.status === 201 } : result;
}

export async function patchItem(id: string, patch: ItemPatch, deps: ClientDeps = defaultDeps) {
  return await mutation(deps, `/api/me/items/${id}`, jsonInit("PATCH", patch));
}

export async function changeStage(id: string, input: ItemStageInput, deps: ClientDeps = defaultDeps) {
  return await mutation(deps, `/api/me/items/${id}/stage`, jsonInit("POST", input));
}

export async function moveItem(id: string, profileId: string, deps: ClientDeps = defaultDeps) {
  return await mutation(deps, `/api/me/items/${id}/move`, jsonInit("POST", { profileId }));
}

export async function trashItem(id: string, deps: ClientDeps = defaultDeps) {
  return await mutation(deps, `/api/me/items/${id}`, { method: "DELETE" });
}

/** Lists, tags and other batch edits on one item; the answer has no item, only what changed and the undo. */
export async function bulkItems(body: ItemBulk, deps: ClientDeps = defaultDeps) {
  return await call(deps, "/api/me/items/bulk", jsonInit("POST", body), mutationResultSchema);
}

/** Replays the `undo` that a mutation returned. */
export async function undoMutation(payload: UndoPayload, deps: ClientDeps = defaultDeps) {
  return await call(deps, "/api/me/items/undo", jsonInit("POST", payload), mutationResultSchema);
}

export async function uploadPhoto(id: string, file: File, deps: ClientDeps = defaultDeps) {
  const form = new FormData();
  form.set("file", file);
  return await mutation(deps, `/api/me/items/${id}/media`, { method: "POST", body: form });
}

/** Starts the import of a photo from its address; the answer is the id to follow with `fetchPhotoImport`. */
export async function importPhoto(id: string, url: string, deps: ClientDeps = defaultDeps) {
  return await call(
    deps,
    `/api/me/items/${id}/media/imports`,
    jsonInit("POST", { url }),
    photoImportAcceptedSchema,
    [202],
  );
}

/** Where an import stands. Throws on a network error or a malformed answer (the poller tries again). */
export async function fetchPhotoImport(
  id: string,
  importId: string,
  deps: ClientDeps = defaultDeps,
  signal?: AbortSignal,
) {
  const response = await deps.fetch(`/api/me/items/${id}/media/imports/${importId}`, {
    cache: "no-store",
    signal: signal ?? null,
  });
  if (!response.ok) throw new Error(`photo import ${response.status}`);
  return photoImportViewSchema.parse(await response.json());
}

export async function removePhoto(id: string, mediaId: string, deps: ClientDeps = defaultDeps) {
  return await mutation(deps, `/api/me/items/${id}/media/${mediaId}`, { method: "DELETE" });
}

/** Her active item for a product, or null. Throws on a network error or a malformed answer. */
export async function fetchItemForProduct(
  productId: string,
  deps: ClientDeps = defaultDeps,
  signal?: AbortSignal,
): Promise<ItemView | null> {
  const response = await deps.fetch(`/api/me/items?product=${productId}`, {
    cache: "no-store",
    signal: signal ?? null,
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`items ${response.status}`);
  return itemPageSchema.parse(await response.json()).items[0] ?? null;
}

export async function fetchWishlists(deps: ClientDeps = defaultDeps): Promise<WishlistView[]> {
  const response = await deps.fetch("/api/me/wishlists", { cache: "no-store" });
  if (response.status === 401) return [];
  if (!response.ok) throw new Error(`wishlists ${response.status}`);
  return wishlistListSchema.parse(await response.json()).wishlists;
}

export async function createWishlist(name: string, deps: ClientDeps = defaultDeps) {
  return await call(deps, "/api/me/wishlists", jsonInit("POST", { name }), wishlistViewSchema);
}

export async function fetchTags(deps: ClientDeps = defaultDeps): Promise<TagView[]> {
  const response = await deps.fetch("/api/me/tags", { cache: "no-store" });
  if (response.status === 401) return [];
  if (!response.ok) throw new Error(`tags ${response.status}`);
  return tagListSchema.parse(await response.json()).tags;
}

export async function createTag(name: string, deps: ClientDeps = defaultDeps) {
  return await call(deps, "/api/me/tags", jsonInit("POST", { name }), tagViewSchema);
}

/** The « Annuler » of a mutation: replays its `undo`, then `after` (re-reads what changed). Null: nothing to undo. */
export function undoWith(
  undo: UndoPayload | null,
  after: () => Promise<void>,
  deps: ClientDeps = defaultDeps,
): (() => Promise<boolean>) | null {
  if (!undo) return null;
  return async () => {
    const result = await undoMutation(undo, deps);
    await after();
    return result.ok;
  };
}

/** One page of a view (48 items). `query` is the filters; `cursor` comes from the previous page. Throws on failure. */
export async function fetchItemsPage(
  query: Record<string, string>,
  cursor: string | null,
  deps: ClientDeps = defaultDeps,
  signal?: AbortSignal,
): Promise<ItemPage> {
  const params = new URLSearchParams(query);
  if (cursor) params.set("cursor", cursor);
  const response = await deps.fetch(`/api/me/items?${params}`, { cache: "no-store", signal: signal ?? null });
  // No session yet: nothing kept, nothing to show.
  if (response.status === 401) return { items: [], nextCursor: null };
  if (!response.ok) throw new Error(`items ${response.status}`);
  return itemPageSchema.parse(await response.json());
}

/** Categories and colours of the filters (public, cached by the browser for an hour). */
export async function fetchReference(deps: ClientDeps = defaultDeps): Promise<ReferenceView> {
  const response = await deps.fetch("/api/reference");
  if (!response.ok) throw new Error(`reference ${response.status}`);
  return referenceViewSchema.parse(await response.json());
}

export async function fetchFacets(deps: ClientDeps = defaultDeps): Promise<FacetsView> {
  const response = await deps.fetch("/api/me/facets", { cache: "no-store" });
  if (response.status === 401) return { shops: [] };
  if (!response.ok) throw new Error(`facets ${response.status}`);
  return facetsViewSchema.parse(await response.json());
}

/** A call whose success is a 204 with no body. */
async function callNoContent(deps: ClientDeps, path: string, init: RequestInit): Promise<Result<object>> {
  try {
    await deps.ensure();
    const response = await deps.fetch(path, init);
    if (response.status === 204) return { ok: true };
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    if (typeof body?.error === "string" && KNOWN_ERRORS.includes(body.error)) {
      return { ok: false, error: body.error as ClientError };
    }
  } catch {
    // Falls through to the generic error.
  }
  return { ok: false, error: "failed" };
}

export async function renameWishlist(id: string, name: string, deps: ClientDeps = defaultDeps) {
  return await call(deps, `/api/me/wishlists/${id}`, jsonInit("PATCH", { name }), wishlistViewSchema);
}

export async function deleteWishlist(id: string, deps: ClientDeps = defaultDeps) {
  return await callNoContent(deps, `/api/me/wishlists/${id}`, { method: "DELETE" });
}

export async function reorderWishlists(ids: readonly string[], deps: ClientDeps = defaultDeps) {
  return await call(deps, "/api/me/wishlists/order", jsonInit("POST", { ids }), wishlistListSchema);
}

export async function reorderWishlistItems(id: string, ids: readonly string[], deps: ClientDeps = defaultDeps) {
  return await call(deps, `/api/me/wishlists/${id}/order`, jsonInit("POST", { ids }), wishlistViewSchema);
}

export async function removeFromWishlist(id: string, itemId: string, deps: ClientDeps = defaultDeps) {
  return await call(deps, `/api/me/wishlists/${id}/items/${itemId}`, { method: "DELETE" }, wishlistViewSchema);
}

/** Makes a new link (`/l/<token>`, shown this once) and ends the previous one. */
export async function shareWishlist(id: string, deps: ClientDeps = defaultDeps) {
  return await call(deps, `/api/me/wishlists/${id}/share`, { method: "POST" }, shareResultSchema);
}

export async function unshareWishlist(id: string, deps: ClientDeps = defaultDeps) {
  return await callNoContent(deps, `/api/me/wishlists/${id}/share`, { method: "DELETE" });
}

export async function createProfile(input: ProfileInput, deps: ClientDeps = defaultDeps) {
  return await call(deps, "/api/me/profiles", jsonInit("POST", input), profileViewSchema);
}

export async function patchProfile(id: string, patch: ProfilePatch, deps: ClientDeps = defaultDeps) {
  return await call(deps, `/api/me/profiles/${id}`, jsonInit("PATCH", patch), profileViewSchema);
}

/** Refused with `profile_not_empty` while the profile holds active items. */
export async function deleteProfile(id: string, deps: ClientDeps = defaultDeps) {
  return await callNoContent(deps, `/api/me/profiles/${id}`, { method: "DELETE" });
}

export async function reorderProfiles(ids: readonly string[], deps: ClientDeps = defaultDeps) {
  return await call(deps, "/api/me/profiles/order", jsonInit("POST", { ids }), profileListSchema);
}

export async function patchTag(id: string, patch: TagPatch, deps: ClientDeps = defaultDeps) {
  return await call(deps, `/api/me/tags/${id}`, jsonInit("PATCH", patch), tagViewSchema);
}

export async function deleteTag(id: string, deps: ClientDeps = defaultDeps) {
  return await callNoContent(deps, `/api/me/tags/${id}`, { method: "DELETE" });
}

/** Takes an item out of the trash; when she kept the product again meanwhile, both are merged (`item.id` differs). */
export async function restoreItem(id: string, deps: ClientDeps = defaultDeps) {
  return await mutation(deps, `/api/me/items/${id}/restore`, { method: "POST" });
}

/** Deletes a trashed item for good (photos included). No undo. */
export async function purgeItem(id: string, deps: ClientDeps = defaultDeps) {
  return await callNoContent(deps, `/api/me/items/${id}/purge`, { method: "DELETE" });
}

/** The links she pasted lately and has not kept. Null without a session; throws on any other failure. */
export async function fetchRecents(deps: ClientDeps = defaultDeps): Promise<RecentList | null> {
  const response = await deps.fetch("/api/me/recents", { cache: "no-store" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`recents ${response.status}`);
  return recentListSchema.parse(await response.json());
}

export async function forgetRecent(productId: string, deps: ClientDeps = defaultDeps) {
  return await callNoContent(deps, `/api/me/recents/${productId}`, { method: "DELETE" });
}
