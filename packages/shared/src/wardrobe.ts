import { z } from "zod";
import { currencySchema, productViewSchema } from "./catalog";

export const itemStageSchema = z.enum(["spotted", "ordered", "owned", "for_sale", "sold", "returned"]);
export const audienceSchema = z.enum(["women", "men", "child", "mixed"]);
export const childDetailSchema = z.enum(["girl", "boy", "baby"]);
export const seasonSchema = z.enum(["summer", "winter", "mid", "all"]);
export const itemEventTypeSchema = z.enum(["stage", "profile"]);
export const classifiedBySchema = z.enum(["rule", "admin"]);
/** Names of palette tokens, never raw colours. */
export const profileColorSchema = z.enum(["plum", "rose", "sage", "sand", "sky", "slate"]);
export type ItemStage = z.infer<typeof itemStageSchema>;
export type Audience = z.infer<typeof audienceSchema>;
export type ChildDetail = z.infer<typeof childDetailSchema>;
export type Season = z.infer<typeof seasonSchema>;
export type ItemEventType = z.infer<typeof itemEventTypeSchema>;
export type ClassifiedBy = z.infer<typeof classifiedBySchema>;
export type ProfileColor = z.infer<typeof profileColorSchema>;

/** Rank used to keep "the most advanced stage" when two items are merged; `returned` ranks like `owned`. */
export const ITEM_STAGE_ORDER: Record<ItemStage, number> = {
  spotted: 0,
  ordered: 1,
  owned: 2,
  returned: 2,
  for_sale: 3,
  sold: 4,
};

export const MAX_ITEM_PHOTOS = 10;
export const MAX_BULK_ITEMS = 200;
export const MAX_ITEMS_CREATED_PER_HOUR = 300;
export const ITEMS_PAGE_SIZE = 48;
export const MAX_PROFILE_NAME = 40;
export const MAX_WISHLIST_NAME = 80;
export const MAX_TAG_NAME = 40;
export const MAX_SIZE_LABEL = 40;
export const MAX_SIZE_NOTE = 200;
export const MAX_NOTES = 2000;
export const MAX_SALE_CHANNEL = 60;
/** Delay of the "Undo" button, and retention of the trash. */
export const UNDO_DELAY_MS = 8000;
export const TRASH_RETENTION_DAYS = 30;

const centsSchema = z.number().int().nonnegative();
const dateTimeSchema = z.iso.datetime({ offset: true });
const nameOf = (max: number) => z.string().trim().min(1).max(max);

export const profileInputSchema = z.object({
  name: nameOf(MAX_PROFILE_NAME),
  audience: audienceSchema,
  childDetail: childDetailSchema.nullable().optional(),
  color: profileColorSchema,
});
export type ProfileInput = z.infer<typeof profileInputSchema>;

export const itemCreateSchema = z
  .object({
    productId: z.uuid(),
    profileId: z.uuid().optional(),
    action: z.enum(["favorite", "list", "ordered"]),
    wishlistId: z.uuid().optional(),
  })
  .refine((v) => v.action !== "list" || v.wishlistId !== undefined, {
    error: "wishlistId is required for action list",
    path: ["wishlistId"],
  });
export type ItemCreate = z.infer<typeof itemCreateSchema>;

export const itemPatchSchema = z.object({
  favorite: z.boolean().optional(),
  sizeLabel: z.string().max(MAX_SIZE_LABEL).nullable().optional(),
  sizeNote: z.string().max(MAX_SIZE_NOTE).nullable().optional(),
  notes: z.string().max(MAX_NOTES).nullable().optional(),
  nameOverride: z.string().trim().min(1).max(300).nullable().optional(),
  brandOverride: z.string().trim().min(1).max(120).nullable().optional(),
  categoryId: z.uuid().nullable().optional(),
  colorId: z.uuid().nullable().optional(),
  coverMediaId: z.uuid().nullable().optional(),
});
export type ItemPatch = z.infer<typeof itemPatchSchema>;

export const itemStageInputSchema = z.object({
  stage: itemStageSchema,
  at: dateTimeSchema,
  amountCents: centsSchema.optional(),
  channel: z.string().trim().min(1).max(MAX_SALE_CHANNEL).optional(),
});
export type ItemStageInput = z.infer<typeof itemStageInputSchema>;

export const itemMoveSchema = z.object({ profileId: z.uuid() });
export type ItemMove = z.infer<typeof itemMoveSchema>;

const bulkIds = z
  .array(z.uuid())
  .min(1)
  .max(MAX_BULK_ITEMS)
  .refine((ids) => new Set(ids).size === ids.length, { error: "ids must be unique" });
export const itemBulkSchema = z.discriminatedUnion("op", [
  z.object({ ids: bulkIds, op: z.literal("stage"), ...itemStageInputSchema.shape }),
  z.object({ ids: bulkIds, op: z.literal("addToList"), wishlistId: z.uuid() }),
  z.object({ ids: bulkIds, op: z.literal("removeFromList"), wishlistId: z.uuid() }),
  z.object({ ids: bulkIds, op: z.literal("move"), profileId: z.uuid() }),
  z.object({ ids: bulkIds, op: z.literal("addTag"), tagId: z.uuid() }),
  z.object({ ids: bulkIds, op: z.literal("removeTag"), tagId: z.uuid() }),
  z.object({ ids: bulkIds, op: z.literal("delete") }),
  z.object({ ids: bulkIds, op: z.literal("restore") }),
  z.object({ ids: bulkIds, op: z.literal("setFavorite"), favorite: z.boolean() }),
]);
export type ItemBulk = z.infer<typeof itemBulkSchema>;

export const tagInputSchema = z.object({ name: nameOf(MAX_TAG_NAME), color: profileColorSchema.optional() });
export type TagInput = z.infer<typeof tagInputSchema>;

export const wishlistInputSchema = z.object({ name: nameOf(MAX_WISHLIST_NAME) });
export type WishlistInput = z.infer<typeof wishlistInputSchema>;

export const itemSortSchema = z.enum(["recent", "oldest", "name", "price_asc", "price_desc"]);
export type ItemSort = z.infer<typeof itemSortSchema>;

/** Query string of `GET /api/me/items`. */
export const itemListQuerySchema = z.object({
  stage: itemStageSchema.optional(),
  profile: z.uuid().optional(),
  favorite: z.stringbool().optional(),
  tag: z.uuid().optional(),
  shop: z.string().min(1).max(100).optional(),
  category: z.uuid().optional(),
  color: z.uuid().optional(),
  audience: audienceSchema.optional(),
  sort: itemSortSchema.optional(),
  /** Trash view: only deleted items. */
  deleted: z.stringbool().optional(),
  /** Opaque; room for a 300-character name key in UTF-8, base64url-encoded. */
  cursor: z.string().min(1).max(2000).optional(),
});
export type ItemListQuery = z.infer<typeof itemListQuerySchema>;

export const profileViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  audience: audienceSchema,
  childDetail: childDetailSchema.nullable(),
  color: profileColorSchema,
  position: z.number().int(),
  itemCount: z.number().int().nonnegative().optional(),
});
export type ProfileView = z.infer<typeof profileViewSchema>;

export const tagViewSchema = z.object({ id: z.uuid(), name: z.string(), color: profileColorSchema.nullable() });
export type TagView = z.infer<typeof tagViewSchema>;

export const itemPhotoViewSchema = z.object({
  id: z.uuid(),
  url: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  source: z.enum(["private", "shop"]),
});
export type ItemPhotoView = z.infer<typeof itemPhotoViewSchema>;

/** An item with its product resolved: effective name/brand, price and sizes from the product, private photos first. */
export const itemViewSchema = z.object({
  id: z.uuid(),
  profileId: z.uuid(),
  product: productViewSchema,
  stage: itemStageSchema,
  favorite: z.boolean(),
  /** Override if any, else the product's. */
  name: z.string().nullable(),
  brand: z.string().nullable(),
  sizeLabel: z.string().nullable(),
  sizeNote: z.string().nullable(),
  notes: z.string().nullable(),
  pricePaidCents: centsSchema.nullable(),
  salePriceCents: centsSchema.nullable(),
  saleChannel: z.string().nullable(),
  nameOverride: z.string().nullable(),
  brandOverride: z.string().nullable(),
  categoryId: z.uuid().nullable(),
  colorId: z.uuid().nullable(),
  coverMediaId: z.uuid().nullable(),
  coverUrl: z.string().nullable(),
  photos: z.array(itemPhotoViewSchema),
  tags: z.array(tagViewSchema),
  wishlistIds: z.array(z.uuid()),
  deletedAt: dateTimeSchema.nullable(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});
export type ItemView = z.infer<typeof itemViewSchema>;

export const itemPageSchema = z.object({ items: z.array(itemViewSchema), nextCursor: z.string().nullable() });
export type ItemPage = z.infer<typeof itemPageSchema>;

export const wishlistViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  itemIds: z.array(z.uuid()),
  shared: z.boolean(),
  sharedAt: dateTimeSchema.nullable(),
  position: z.number().int(),
});
export type WishlistView = z.infer<typeof wishlistViewSchema>;

/** Public content of a shared list (G4): never private photos, notes, sizes or profiles. */
export const sharedWishlistViewSchema = z.object({
  name: z.string(),
  items: z.array(
    z.object({
      name: z.string().nullable(),
      brand: z.string().nullable(),
      priceCents: centsSchema.nullable(),
      currency: currencySchema.nullable(),
      imageUrl: z.string().nullable(),
      shopName: z.string(),
      url: z.string(),
    }),
  ),
});
export type SharedWishlistView = z.infer<typeof sharedWishlistViewSchema>;

/** Returned only by the share action: `/l/<token>`; the token is never stored, so it cannot be shown again. */
export const shareResultSchema = z.object({ url: z.string().regex(/^\/l\/[A-Za-z0-9_-]+$/) });
export type ShareResult = z.infer<typeof shareResultSchema>;

/**
 * What "Undo" replays through `POST /api/me/items/undo`, in one transaction: one inverse bulk op per distinct previous
 * value, restricted to the items actually changed, and the history rows the action created (deleted, not completed).
 */
export const undoPayloadSchema = z.object({
  ops: z
    .array(itemBulkSchema)
    .min(1)
    .max(2 * MAX_BULK_ITEMS),
  removeEventIds: z.array(z.uuid()).max(2 * MAX_BULK_ITEMS),
});
export type UndoPayload = z.infer<typeof undoPayloadSchema>;

/** Answer of every action: what changed, and how to undo it. */
export const mutationResultSchema = z.object({
  itemIds: z.array(z.uuid()),
  undo: undoPayloadSchema.nullable(),
});
export type MutationResult = z.infer<typeof mutationResultSchema>;

/** An item action's answer: the mutation result and the item as it now is (created, existing, changed or merged). */
export const itemMutationResultSchema = mutationResultSchema.extend({ item: itemViewSchema });
export type ItemMutationResult = z.infer<typeof itemMutationResultSchema>;

export const profilePatchSchema = profileInputSchema.partial();
export type ProfilePatch = z.infer<typeof profilePatchSchema>;

export const profileListSchema = z.object({ profiles: z.array(profileViewSchema) });
export type ProfileList = z.infer<typeof profileListSchema>;

/** New order of her profiles: every one of her profile ids, exactly once. */
export const profileOrderSchema = z.object({
  ids: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, { error: "ids must be unique" }),
});
export type ProfileOrder = z.infer<typeof profileOrderSchema>;

/** What the app shell needs: the account proposal (anonymous session, item count) and the profiles. */
export const summaryViewSchema = z.object({
  isAnonymous: z.boolean(),
  /** Active items (not in the trash). */
  itemCount: z.number().int().nonnegative(),
  profiles: z.array(profileViewSchema),
});
export type SummaryView = z.infer<typeof summaryViewSchema>;

/** Stable error codes of the `/api/me/profiles`, `/api/me/items` and `/api/me/summary` routes. */
export const wardrobeErrorCodes = [
  "invalid_request",
  "invalid_cursor",
  "not_found",
  "rate_limited",
  "profile_not_empty",
  "same_stage",
  "same_profile",
  "invalid_cover",
  "invalid_category",
  "invalid_color",
  "item_deleted",
  "item_not_deleted",
] as const;
export const wardrobeErrorSchema = z.object({ error: z.enum(wardrobeErrorCodes) });
export type WardrobeErrorCode = (typeof wardrobeErrorCodes)[number];
