import { createAuthClient, ensureSession } from "@closyria/auth/client";
import {
  type ItemBulk,
  type ItemCreate,
  type ItemPatch,
  type ItemStageInput,
  type ItemView,
  itemMutationResultSchema,
  itemPageSchema,
  mediaErrorCodes,
  mutationResultSchema,
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
