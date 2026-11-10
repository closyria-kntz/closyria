import { createAuthClient, ensureSession } from "@closyria/auth/client";
import {
  type BudgetHistory,
  type BudgetInput,
  type BudgetView,
  budgetHistorySchema,
  budgetViewSchema,
  changesSchema,
  DEFAULT_LOVE_LEVELS,
  type ErasedOpinion,
  erasedOpinionSchema,
  type FacetsView,
  facetsViewSchema,
  type GiftReminderAction,
  type GiftSettingsPatch,
  type GroupOrderAction,
  type GroupOrderCreate,
  type GroupOrderOrder,
  type GroupOrderOwnLines,
  type GroupOrderOwnLink,
  type GroupOrderPatch,
  giftCheckSchema,
  groupOrderPastListSchema,
  type ItemBulkAction,
  type ItemCreate,
  type ItemPage,
  type ItemPatch,
  type ItemStageInput,
  type ItemView,
  itemMutationResultSchema,
  itemOpinionsSchema,
  itemPageSchema,
  type LoveLevel,
  type LoveLevelView,
  loveLevelsSchema,
  mediaErrorCodes,
  mutationResultSchema,
  type OrderDraftInput,
  type OwnerGroupOrder,
  ownerGroupOrderSchema,
  type ProfileInput,
  type ProfilePatch,
  photoImportAcceptedSchema,
  photoImportViewSchema,
  priceHistorySchema,
  profileListSchema,
  profileViewSchema,
  type RecentList,
  type ReferenceView,
  recentListSchema,
  referenceViewSchema,
  shareLinkSchema,
  shareResultSchema,
  shippingOptionListSchema,
  type TagPatch,
  type TagView,
  tagListSchema,
  tagViewSchema,
  type UndoPayload,
  type WishlistSettings,
  type WishlistView,
  wardrobeErrorCodes,
  wishlistListSchema,
  wishlistOpinionsSchema,
  wishlistViewSchema,
} from "@closyria/shared";
import { type ZodType, z } from "zod";
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

/** Her « Pourquoi ? » as the API keeps it: trimmed, a blank one is null. */
export function whyOrNull(why: string): string | null {
  return why.trim() || null;
}

/** What she chose on the sheet before « Ajouter à mes envies ». */
export type WishChoice = { loveLevel: LoveLevel; priority: boolean; why: string };

/** The « Ajouter à mes envies » request: her level, priority and opinion (a blank one is left out). */
export function wishCreate(base: { productId: string; profileId?: string }, choice: WishChoice): ItemCreate {
  const why = whyOrNull(choice.why);
  return {
    ...base,
    action: "wish",
    loveLevel: choice.loveLevel,
    priority: choice.priority,
    ...(why ? { why } : {}),
  };
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
export async function bulkItems(body: ItemBulkAction, deps: ClientDeps = defaultDeps) {
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

/** A product's price history over the last `days` days. Throws on a network error or a malformed answer. */
export async function fetchPriceHistory(productId: string, days = 90, deps: ClientDeps = defaultDeps) {
  const response = await deps.fetch(`/api/products/${productId}/price-history?days=${days}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`price-history ${response.status}`);
  return priceHistorySchema.parse(await response.json());
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

/** Her names and emojis for the 4 levels; the starting ones without a session. Throws on any other failure. */
export async function fetchLoveLevels(deps: ClientDeps = defaultDeps): Promise<LoveLevelView[]> {
  const response = await deps.fetch("/api/me/love-levels", { cache: "no-store" });
  if (response.status === 401) return [...DEFAULT_LOVE_LEVELS];
  if (!response.ok) throw new Error(`love levels ${response.status}`);
  return loveLevelsSchema.parse(await response.json()).levels;
}

/** The fingerprint of her data (null without a session): a new one means something changed elsewhere. */
export async function fetchChangesStamp(deps: ClientDeps = defaultDeps): Promise<string | null> {
  const response = await deps.fetch("/api/me/changes", { cache: "no-store" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`changes ${response.status}`);
  return changesSchema.parse(await response.json()).stamp;
}

/** Replaces her 4 levels (Réglages → Mes niveaux). */
export async function saveLoveLevels(levels: readonly LoveLevelView[], deps: ClientDeps = defaultDeps) {
  return await call(deps, "/api/me/love-levels", jsonInit("PUT", { levels }), loveLevelsSchema);
}

/** Back to the starting levels. */
export async function resetLoveLevels(deps: ClientDeps = defaultDeps) {
  return await callNoContent(deps, "/api/me/love-levels", { method: "DELETE" });
}

/** Whose budget (and selection): a profile's, or a list's (spec §3.6, §3.7). */
export type BudgetScope = OrderDraftInput;

const budgetPath = (scope: BudgetScope) =>
  "profileId" in scope ? `/api/me/profiles/${scope.profileId}/budget` : `/api/me/wishlists/${scope.wishlistId}/budget`;

/** Her budget, or null when she set none (or has no session yet). Throws on any other failure. */
export async function fetchBudget(scope: BudgetScope, deps: ClientDeps = defaultDeps): Promise<BudgetView | null> {
  const response = await deps.fetch(budgetPath(scope), { cache: "no-store" });
  if (response.status === 404 || response.status === 401) return null;
  if (!response.ok) throw new Error(`budget ${response.status}`);
  return budgetViewSchema.parse(await response.json());
}

/** Creates or changes it. */
export async function saveBudget(scope: BudgetScope, input: BudgetInput, deps: ClientDeps = defaultDeps) {
  return await call(deps, budgetPath(scope), jsonInit("PUT", input), budgetViewSchema);
}

export async function deleteBudget(scope: BudgetScope, deps: ClientDeps = defaultDeps) {
  return await callNoContent(deps, budgetPath(scope), { method: "DELETE" });
}

/** « Recommencer à zéro »: a budget without a period only (`budget_not_resettable` otherwise). */
export async function resetBudget(scope: BudgetScope, deps: ClientDeps = defaultDeps) {
  return await call(deps, `${budgetPath(scope)}/reset`, { method: "POST" }, budgetViewSchema);
}

/** Its past weeks or months, newest first; none without a budget. Throws on any other failure. */
export async function fetchBudgetHistory(
  scope: BudgetScope,
  deps: ClientDeps = defaultDeps,
): Promise<BudgetHistory["periods"]> {
  const response = await deps.fetch(`${budgetPath(scope)}/history`, { cache: "no-store" });
  if (response.status === 404 || response.status === 401) return [];
  if (!response.ok) throw new Error(`budget history ${response.status}`);
  return budgetHistorySchema.parse(await response.json()).periods;
}

/** « J'ai commandé »: the ticked wishes of the profile or the list go to « Commandé », with their undo. */
export async function orderDraftOrdered(scope: BudgetScope, deps: ClientDeps = defaultDeps) {
  return await call(deps, "/api/me/order-draft/ordered", jsonInit("POST", scope), mutationResultSchema);
}

/** Changes how a list is shared (any of the four settings, and the gift ones). */
export async function patchWishlistSettings(
  id: string,
  patch: Partial<WishlistSettings> & GiftSettingsPatch,
  deps: ClientDeps = defaultDeps,
) {
  return await call(deps, `/api/me/wishlists/${id}`, jsonInit("PATCH", patch), wishlistViewSchema);
}

/** The link of a shared list (`url` null: not shared, or shared before links were kept). */
export async function fetchShareLink(id: string, deps: ClientDeps = defaultDeps) {
  return await call(deps, `/api/me/wishlists/${id}/share`, { method: "GET" }, shareLinkSchema);
}

export async function fetchWishlistOpinions(id: string, deps: ClientDeps = defaultDeps) {
  return await call(
    deps,
    `/api/me/wishlists/${id}/opinions`,
    { method: "GET", cache: "no-store" },
    wishlistOpinionsSchema,
  );
}

export async function markOpinionsSeen(id: string, deps: ClientDeps = defaultDeps) {
  return await callNoContent(deps, `/api/me/wishlists/${id}/opinions/seen`, { method: "POST" });
}

const erasedResultSchema = z.object({ opinion: erasedOpinionSchema });

/** Erases a friend's opinion; the result carries it for « Annuler ». */
export async function deleteOpinion(listId: string, opinionId: string, deps: ClientDeps = defaultDeps) {
  return await call(
    deps,
    `/api/me/wishlists/${listId}/opinions/${opinionId}`,
    { method: "DELETE" },
    erasedResultSchema,
  );
}

export async function restoreOpinion(listId: string, opinion: ErasedOpinion, deps: ClientDeps = defaultDeps) {
  return await call(
    deps,
    `/api/me/wishlists/${listId}/opinions/restore`,
    jsonInit("POST", { opinion }),
    erasedResultSchema,
  );
}

export async function fetchItemOpinions(itemId: string, deps: ClientDeps = defaultDeps) {
  return await call(deps, `/api/me/items/${itemId}/opinions`, { method: "GET", cache: "no-store" }, itemOpinionsSchema);
}

/** Every wish of the scope at « Repéré », page by page. Throws on failure. */
export async function fetchAllWishes(query: Record<string, string>): Promise<ItemView[]> {
  const items: ItemView[] = [];
  let cursor: string | null = null;
  do {
    const page = await fetchItemsPage(query, cursor);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

/** How long the gift check may take before her purchase goes on without it. */
export const GIFT_CHECK_TIMEOUT_MS = 4_000;

/**
 * Which of these items a friend plans to give her (ids only). Asked only right before she buys (`confirmUnlessReserved`),
 * never to show anything. Throws on any failure or after 4 s (the purchase goes on without asking).
 */
export async function fetchReservedIds(ids: readonly string[], deps: ClientDeps = defaultDeps): Promise<string[]> {
  await deps.ensure();
  const params = new URLSearchParams({ ids: ids.join(",") });
  // A slow check never holds her purchase: past the wait, it fails and she goes on without the window.
  const response = await deps.fetch(`/api/me/items/gift-check?${params}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(GIFT_CHECK_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`gift-check ${response.status}`);
  return giftCheckSchema.parse(await response.json()).reserved;
}

/** « Je le prends quand même »: her friends see she took these items herself. */
export async function markGiftTook(ids: readonly string[], deps: ClientDeps = defaultDeps) {
  return await callNoContent(deps, "/api/me/items/gift-took", jsonInit("POST", { ids }));
}

/** « Reçu en cadeau »: to « Reçu », marked a gift; the undo brings back the stage and her friends' gifts. */
export async function receiveAsGift(id: string, deps: ClientDeps = defaultDeps) {
  return await mutation(deps, `/api/me/items/${id}/received-as-gift`, jsonInit("POST", {}));
}

/** The reminder after the occasion: « Plus tard » (`snooze`, 7 days) or « C'est fait » (`dismiss`). */
export async function answerGiftReminder(
  id: string,
  action: GiftReminderAction["action"],
  deps: ClientDeps = defaultDeps,
) {
  return await callNoContent(deps, `/api/me/wishlists/${id}/gift-reminder`, jsonInit("POST", { action }));
}

/** Her group order as one value (its `status` is the order's, never the HTTP one), or an API error code. */
export type GroupOrderResult = { ok: true; order: OwnerGroupOrder } | { ok: false; error: ClientError };

// Wrapped: `call` adds the HTTP status beside the body, and the order has a `status` of its own.
const orderResultSchema = ownerGroupOrderSchema.transform((order) => ({ order }));
async function groupOrderCall(deps: ClientDeps, path: string, init: RequestInit): Promise<GroupOrderResult> {
  const result = await call(deps, path, init, orderResultSchema);
  return result.ok ? { ok: true, order: result.order } : result;
}

/** « Ouvrir une commande groupée » on a shared list. */
export async function openGroupOrder(listId: string, input: GroupOrderCreate, deps: ClientDeps = defaultDeps) {
  return await groupOrderCall(deps, `/api/me/wishlists/${listId}/group-order`, jsonInit("POST", input));
}

/** The running one of the list, else the last one ordered or cancelled in 30 days; `not_found`: none. */
export async function fetchGroupOrder(listId: string, deps: ClientDeps = defaultDeps) {
  return await groupOrderCall(deps, `/api/me/wishlists/${listId}/group-order`, { method: "GET", cache: "no-store" });
}

/** One of her group orders, of any state or age (a past one opened from the list). */
export async function fetchGroupOrderById(id: string, deps: ClientDeps = defaultDeps) {
  return await groupOrderCall(deps, `/api/me/group-orders/${id}`, { method: "GET", cache: "no-store" });
}

/** « Commandes groupées passées » of a list. */
export async function fetchPastGroupOrders(listId: string, deps: ClientDeps = defaultDeps) {
  return await call(
    deps,
    `/api/me/wishlists/${listId}/group-orders`,
    { method: "GET", cache: "no-store" },
    groupOrderPastListSchema,
  );
}

/** A shop's delivery options (from the admin), to open a group order. */
export async function fetchShopShippingOptions(shopId: string, deps: ClientDeps = defaultDeps) {
  return await call(
    deps,
    `/api/me/shops/${shopId}/shipping-options`,
    { method: "GET", cache: "no-store" },
    shippingOptionListSchema,
  );
}

export async function patchGroupOrder(id: string, patch: GroupOrderPatch, deps: ClientDeps = defaultDeps) {
  return await groupOrderCall(deps, `/api/me/group-orders/${id}`, jsonInit("PATCH", patch));
}

/** « Clôturer », « Rouvrir », « Annuler la commande groupée ». */
export async function actOnGroupOrder(id: string, action: GroupOrderAction["action"], deps: ClientDeps = defaultDeps) {
  return await groupOrderCall(deps, `/api/me/group-orders/${id}/action`, jsonInit("POST", { action }));
}

/** Her own lines, all of them (« Je le prends dans cette commande »). */
export async function putOwnGroupLines(id: string, body: GroupOrderOwnLines, deps: ClientDeps = defaultDeps) {
  return await groupOrderCall(deps, `/api/me/group-orders/${id}/own-lines`, jsonInit("PUT", body));
}

/** « Ajouter un autre article »: her link of the order's shop, to her wishes, the list and her lines. */
export async function addOwnGroupLink(id: string, body: GroupOrderOwnLink, deps: ClientDeps = defaultDeps) {
  return await groupOrderCall(deps, `/api/me/group-orders/${id}/own-link`, jsonInit("POST", body));
}

/** « Retirer » a friend's line. */
export async function removeGroupLine(id: string, lineId: string, deps: ClientDeps = defaultDeps) {
  return await groupOrderCall(deps, `/api/me/group-orders/${id}/lines/${lineId}`, { method: "DELETE" });
}

/** « Annuler » after « Retirer ». */
export async function restoreGroupLine(id: string, lineId: string, deps: ClientDeps = defaultDeps) {
  return await groupOrderCall(deps, `/api/me/group-orders/${id}/lines/${lineId}/restore`, jsonInit("POST", {}));
}

/** « J'ai commandé »: the real prices and the real shipping. */
export async function orderGroupOrder(id: string, body: GroupOrderOrder, deps: ClientDeps = defaultDeps) {
  return await groupOrderCall(deps, `/api/me/group-orders/${id}/order`, jsonInit("POST", body));
}

/** « Payé » ticked or unticked for one friend (`nameKey`: her `people[].key`). */
export async function setGroupPayment(id: string, nameKey: string, paid: boolean, deps: ClientDeps = defaultDeps) {
  return await groupOrderCall(
    deps,
    `/api/me/group-orders/${id}/payments/${encodeURIComponent(nameKey)}`,
    jsonInit("PUT", { paid }),
  );
}
