import { z } from "zod";
import { audienceSchema, childDetailSchema, currencySchema, productViewSchema, seasonSchema } from "./catalog";

// Defined next to the product view (which shows them); re-exported here, where they began.
export { audienceSchema, childDetailSchema, seasonSchema };

export const itemStageSchema = z.enum(["spotted", "ordered", "owned", "for_sale", "sold", "returned"]);
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
export const MAX_TAGS_PER_ACCOUNT = 200;
export const MAX_SIZE_LABEL = 40;
export const MAX_SIZE_NOTE = 200;
export const MAX_NOTES = 2000;
export const MAX_SALE_CHANNEL = 60;
/** Her « Pourquoi ? » next to the level. */
export const MAX_WHY = 200;

/** How much she loves a wish: 1 Bof, 2 J'aime, 3 Mims, 4 En feu; null = no level. */
export const loveLevelSchema = z.number().int().min(1).max(4);
export type LoveLevel = z.infer<typeof loveLevelSchema>;
/** The level a wish gets when none is given (and the level of the former favorites). */
export const DEFAULT_LOVE_LEVEL: LoveLevel = 2;
/** Longest name she can give a level. */
export const MAX_LOVE_LEVEL_LABEL = 20;

export const loveLevelViewSchema = z.object({
  level: loveLevelSchema,
  emoji: z.string().refine((value) => isSingleEmoji(value), "one emoji"),
  label: z.string().trim().min(1).max(MAX_LOVE_LEVEL_LABEL),
});
export type LoveLevelView = z.infer<typeof loveLevelViewSchema>;
/** Her four levels: exactly 1, 2, 3 and 4, once each. */
export const loveLevelsSchema = z.object({
  levels: z
    .array(loveLevelViewSchema)
    .length(4)
    .refine((levels) => [1, 2, 3, 4].every((n) => levels.filter((l) => l.level === n).length === 1), "levels 1 to 4"),
});
export type LoveLevels = z.infer<typeof loveLevelsSchema>;
/** The names and emojis every account starts with. */
export const DEFAULT_LOVE_LEVELS: readonly LoveLevelView[] = [
  { level: 1, emoji: "😕", label: "Bof" },
  { level: 2, emoji: "🤍", label: "J’aime" },
  { level: 3, emoji: "🥰", label: "Mims" },
  { level: 4, emoji: "🔥", label: "En feu" },
];

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
const EMOJI_GRAPHEME = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3)/u;
/** One emoji (a single grapheme: flag, keycap or pictograph sequence), at most 16 bytes. */
export function isSingleEmoji(value: string): boolean {
  if (new TextEncoder().encode(value).length > 16) return false;
  const parts = [...graphemes.segment(value)];
  const [only] = parts;
  return parts.length === 1 && only !== undefined && EMOJI_GRAPHEME.test(only.segment);
}
/** `week` Monday→Sunday, `month`, `custom` (start…end inclusive), `none` (since her last reset); Europe/Paris. */
export const budgetPeriodSchema = z.enum(["week", "month", "custom", "none"]);
export type BudgetPeriod = z.infer<typeof budgetPeriodSchema>;
/** Delay of the "Undo" button, and retention of the trash. */
export const UNDO_DELAY_MS = 8000;
export const TRASH_RETENTION_DAYS = 30;

/** « Derniers liens »: how many a user sees, and how long a visit is kept. */
export const RECENT_PRODUCTS_LIMIT = 20;
export const RECENT_RETENTION_DAYS = 90;

/** A photo import that is still around this long after creation is purged (with its object unless attached). */
export const PHOTO_IMPORT_RETENTION_HOURS = 24;
export const MAX_PHOTO_IMPORT_URL = 2048;
export const photoImportStatusSchema = z.enum(["queued", "ready", "failed", "attached"]);
export type PhotoImportStatus = z.infer<typeof photoImportStatusSchema>;
export const photoImportErrorSchema = z.enum(["blocked", "timeout", "too_large", "unsupported", "failed"]);
export type PhotoImportError = z.infer<typeof photoImportErrorSchema>;

const centsSchema = z.number().int().nonnegative().max(100_000_000);
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
    action: z.enum(["wish", "list", "ordered"]),
    wishlistId: z.uuid().optional(),
    /** `wish` only; defaults to 2 (J'aime) there. */
    loveLevel: loveLevelSchema.optional(),
    priority: z.boolean().optional(),
    why: z.string().max(MAX_WHY).optional(),
  })
  .refine((v) => v.action !== "list" || v.wishlistId !== undefined, {
    error: "wishlistId is required for action list",
    path: ["wishlistId"],
  });
export type ItemCreate = z.infer<typeof itemCreateSchema>;

export const itemPatchSchema = z.object({
  loveLevel: loveLevelSchema.nullable().optional(),
  priority: z.boolean().optional(),
  why: z.string().max(MAX_WHY).nullable().optional(),
  inOrderDraft: z.boolean().optional(),
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

/** A budget of a profile or of a list. `custom`: both dates (inclusive, Paris), in order; other periods: none. */
export const budgetInputSchema = z
  .object({
    amountCents: centsSchema.positive(),
    period: budgetPeriodSchema,
    startsOn: z.iso.date().optional(),
    endsOn: z.iso.date().optional(),
  })
  .refine(
    (v) =>
      v.period === "custom"
        ? v.startsOn !== undefined && v.endsOn !== undefined && v.startsOn <= v.endsOn
        : v.startsOn === undefined && v.endsOn === undefined,
    { error: "dates required and ordered for custom only", path: ["startsOn"] },
  );
export type BudgetInput = z.infer<typeof budgetInputSchema>;

/**
 * A budget with its current period: `spentCents` = « Déjà commandé » (never below 0), `remainingCents` below 0 when
 * over. `none`: from the last reset (or the creation), `end` far away. After a `custom` budget's last day: `current`
 * null and `ended` true.
 */
export const budgetViewSchema = z.object({
  amountCents: z.number().int().positive(),
  period: budgetPeriodSchema,
  startsOn: z.iso.date().nullable(),
  endsOn: z.iso.date().nullable(),
  current: z
    .object({
      start: dateTimeSchema,
      end: dateTimeSchema,
      spentCents: z.number().int().nonnegative(),
      remainingCents: z.number().int(),
    })
    .nullable(),
  ended: z.boolean(),
});
export type BudgetView = z.infer<typeof budgetViewSchema>;

/** Past periods of a `week` (8) or `month` (12) budget, newest first, at its current amount; empty otherwise. */
export const budgetHistorySchema = z.object({
  periods: z.array(
    z.object({
      start: dateTimeSchema,
      end: dateTimeSchema,
      spentCents: z.number().int().nonnegative(),
      amountCents: z.number().int().positive(),
    }),
  ),
});
export type BudgetHistory = z.infer<typeof budgetHistorySchema>;

export const itemMoveSchema = z.object({ profileId: z.uuid() });
export type ItemMove = z.infer<typeof itemMoveSchema>;

/**
 * Her own fields, as set by `setFields` (bulk and undo): the PATCH fields plus the amounts and sale channel that a
 * stage change writes. At least one field.
 */
export const itemFieldsSchema = itemPatchSchema
  .extend({
    pricePaidCents: centsSchema.nullable().optional(),
    salePriceCents: centsSchema.nullable().optional(),
    saleChannel: z.string().trim().min(1).max(MAX_SALE_CHANNEL).nullable().optional(),
  })
  .refine((fields) => Object.values(fields).some((value) => value !== undefined), {
    error: "at least one field",
  });
export type ItemFields = z.infer<typeof itemFieldsSchema>;

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
  z.object({ ids: bulkIds, op: z.literal("setFields"), fields: itemFieldsSchema }),
]);
export type ItemBulk = z.infer<typeof itemBulkSchema>;

export const tagInputSchema = z.object({ name: nameOf(MAX_TAG_NAME), color: profileColorSchema.optional() });
export type TagInput = z.infer<typeof tagInputSchema>;

/** Rename or recolour a tag; `color: null` removes its colour. */
export const tagPatchSchema = z.object({
  name: nameOf(MAX_TAG_NAME).optional(),
  color: profileColorSchema.nullable().optional(),
});
export type TagPatch = z.infer<typeof tagPatchSchema>;

export const wishlistInputSchema = z.object({ name: nameOf(MAX_WISHLIST_NAME) });
export type WishlistInput = z.infer<typeof wishlistInputSchema>;

export const itemSortSchema = z.enum(["recent", "oldest", "name", "price_asc", "price_desc", "love"]);
export type ItemSort = z.infer<typeof itemSortSchema>;

/** Query string of `GET /api/me/items`. */
export const itemListQuerySchema = z.object({
  stage: itemStageSchema.optional(),
  profile: z.uuid().optional(),
  /** Her item for one product (the product sheet asks whether she keeps it). */
  product: z.uuid().optional(),
  /** Comma-separated levels, e.g. `4,3`. */
  loveLevel: z
    .string()
    .max(20)
    .regex(/^[1-4](,[1-4])*$/)
    .transform((value) => [...new Set(value.split(",").map(Number))] as LoveLevel[])
    .optional(),
  priority: z.stringbool().optional(),
  /** Only the items in (or out of) her order selection. */
  orderDraft: z.stringbool().optional(),
  tag: z.uuid().optional(),
  shop: z.string().min(1).max(100).optional(),
  category: z.uuid().optional(),
  color: z.uuid().optional(),
  audience: audienceSchema.optional(),
  sort: itemSortSchema.optional(),
  /** Only the items of one of her lists, in the list's order (`sort` is ignored). */
  wishlist: z.uuid().optional(),
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

export const tagListSchema = z.object({ tags: z.array(tagViewSchema) });
export type TagList = z.infer<typeof tagListSchema>;

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
  loveLevel: loveLevelSchema.nullable(),
  priority: z.boolean(),
  why: z.string().nullable(),
  inOrderDraft: z.boolean(),
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
      /** Natural size of `imageUrl` (for the viewer's « actual size »); null with it. */
      imageWidth: z.number().int().positive().nullable(),
      imageHeight: z.number().int().positive().nullable(),
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
export const undoPayloadSchema = z
  .object({
    ops: z
      .array(itemBulkSchema)
      .min(1)
      .max(2 * MAX_BULK_ITEMS),
    removeEventIds: z.array(z.uuid()).max(2 * MAX_BULK_ITEMS),
  })
  // An action changes at most 200 items and writes at most two inverse ops per item (stage + amounts).
  .refine((undo) => undo.ops.reduce((n, op) => n + op.ids.length, 0) <= 2 * MAX_BULK_ITEMS, {
    error: "too many ids",
    path: ["ops"],
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

/** pg-boss queue of the photo imports (`POST /api/me/items/{id}/media/imports`), fed by the API, run by the worker. */
export const PHOTO_IMPORT_QUEUE = "photo-import";
/** Data of a `photo-import` job. */
export const photoImportJobSchema = z.object({ importId: z.uuid() });
export type PhotoImportJob = z.infer<typeof photoImportJobSchema>;

/** Body of `POST /api/me/items/{id}/media/imports`: the address of a photo, http(s) only. */
export const photoImportRequestSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1)
    .max(MAX_PHOTO_IMPORT_URL)
    .refine((value) => {
      try {
        const { protocol } = new URL(value);
        return protocol === "http:" || protocol === "https:";
      } catch {
        return false;
      }
    }),
});
export type PhotoImportRequest = z.infer<typeof photoImportRequestSchema>;
export const photoImportAcceptedSchema = z.object({ importId: z.uuid() });

/** Why an import gave no photo: the worker's codes, or the attachment refused (10 photos, item in the trash). */
export const photoImportViewErrorSchema = z.enum([
  ...photoImportErrorSchema.options,
  "too_many_photos",
  "item_deleted",
]);
export type PhotoImportViewError = z.infer<typeof photoImportViewErrorSchema>;
/** `GET /api/me/items/{id}/media/imports/{importId}`. */
export const photoImportViewSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("queued") }),
  z.object({ status: z.literal("failed"), error: photoImportViewErrorSchema }),
  z.object({ status: z.literal("attached"), item: itemViewSchema }),
]);
export type PhotoImportView = z.infer<typeof photoImportViewSchema>;

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

/** New order of a list: every non-deleted item of the list, exactly once. */
export const wishlistOrderSchema = z.object({
  ids: z
    .array(z.uuid())
    .max(5000)
    .refine((ids) => new Set(ids).size === ids.length, { error: "ids must be unique" }),
});
export type WishlistOrder = z.infer<typeof wishlistOrderSchema>;

/** New order of her lists: every one of her list ids, exactly once. */
export const wishlistsOrderSchema = z.object({
  ids: z
    .array(z.uuid())
    .min(1)
    .max(1000)
    .refine((ids) => new Set(ids).size === ids.length, { error: "ids must be unique" }),
});
export type WishlistsOrder = z.infer<typeof wishlistsOrderSchema>;

export const wishlistListSchema = z.object({ wishlists: z.array(wishlistViewSchema) });
export type WishlistList = z.infer<typeof wishlistListSchema>;

export const recentProductViewSchema = z.object({ product: productViewSchema, visitedAt: dateTimeSchema });
export type RecentProductView = z.infer<typeof recentProductViewSchema>;

export const recentListSchema = z.object({ recents: z.array(recentProductViewSchema) });
export type RecentList = z.infer<typeof recentListSchema>;

export const wishlistItemInputSchema = z.object({ itemId: z.uuid() });
export type WishlistItemInput = z.infer<typeof wishlistItemInputSchema>;

/** What the app shell needs: the account proposal (anonymous session, item count) and the profiles. */
export const summaryViewSchema = z.object({
  isAnonymous: z.boolean(),
  /** Who is signed in: her e-mail (null without an account) and when the account was created. */
  account: z.object({ email: z.string().nullable(), createdAt: z.iso.datetime() }),
  /** Active items (not in the trash). */
  itemCount: z.number().int().nonnegative(),
  profiles: z.array(profileViewSchema),
});
export type SummaryView = z.infer<typeof summaryViewSchema>;

/** Categories and colours that the filters (and the item fields) offer; public, cacheable. */
export const referenceViewSchema = z.object({
  categories: z.array(
    z.object({ id: z.uuid(), parentId: z.uuid().nullable(), name: z.string(), position: z.number().int() }),
  ),
  colors: z.array(z.object({ id: z.uuid(), name: z.string(), hex: z.string() })),
});
export type ReferenceView = z.infer<typeof referenceViewSchema>;

/** What the « Boutique » filter offers: the shops of her own (non-deleted) items. */
export const facetsViewSchema = z.object({ shops: z.array(z.object({ id: z.uuid(), name: z.string() })) });
export type FacetsView = z.infer<typeof facetsViewSchema>;

/** Stable error codes of the `/api/me/profiles`, `/api/me/items`, `/api/me/tags` and `/api/me/summary` routes. */
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
  "tag_exists",
  "tag_limit",
  "too_many_photos",
  "budget_not_resettable",
] as const;
export const wardrobeErrorSchema = z.object({ error: z.enum(wardrobeErrorCodes) });
export type WardrobeErrorCode = (typeof wardrobeErrorCodes)[number];
