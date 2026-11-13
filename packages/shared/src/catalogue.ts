import { z } from "zod";
import { itemStageSchema } from "./wardrobe";

/** What a shop can claim, ticked by the admin: used as filters of « Découvrir ». */
export const shopValueSchema = z.enum(["made_in_france", "second_hand", "eco", "free_returns"]);
export type ShopValue = z.infer<typeof shopValueSchema>;

export const catalogSortSchema = z.enum(["new", "price_asc", "price_desc", "popular"]);
export type CatalogSort = z.infer<typeof catalogSortSchema>;

const flag = z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean());
const listOf = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (typeof v === "string" ? v.split(",").filter(Boolean) : v), z.array(item).max(10));

/** `GET /api/catalog` query string (flags are `true`/`false`, values a comma list). */
export const catalogQuerySchema = z.object({
  q: z.string().trim().min(1).max(80).optional(),
  category: z.uuid().optional(),
  color: z.uuid().optional(),
  priceMin: z.coerce.number().int().min(0).optional(),
  priceMax: z.coerce.number().int().min(0).optional(),
  mySize: flag.optional(),
  shop: z.uuid().optional(),
  values: listOf(shopValueSchema).optional(),
  onSale: flag.optional(),
  isNew: flag.optional(),
  sort: catalogSortSchema.default("new"),
  cursor: z.string().max(200).optional(),
  /** Her profile whose sizes « Ma taille en stock » uses; her first profile when absent. */
  profile: z.uuid().optional(),
});
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

const shopRef = z.object({ id: z.uuid(), name: z.string() });

export const catalogCardSchema = z.object({
  productId: z.uuid(),
  name: z.string(),
  shop: shopRef,
  imageUrl: z.string(),
  priceCents: z.number().int().nonnegative(),
  previousPriceCents: z.number().int().nonnegative().nullable(),
  currency: z.string().length(3),
  /** Null when she has no size for this kind of article. */
  sizeInStock: z.boolean().nullable(),
  wanted: z.boolean(),
});
export type CatalogCard = z.infer<typeof catalogCardSchema>;

export const catalogPageSchema = z.object({
  items: z.array(catalogCardSchema),
  nextCursor: z.string().nullable(),
});
export type CatalogPage = z.infer<typeof catalogPageSchema>;

/** « Tu as déjà quelque chose de proche »: one of her own pieces (« Reçu » / « Dans mon dressing »), never anyone else's. */
export const catalogClosePieceSchema = z.object({
  itemId: z.uuid(),
  name: z.string(),
  /** Her cover, else the shop's first photo, else her first own photo (the item card's rule); null without any. */
  imageUrl: z.string().nullable(),
  stage: itemStageSchema,
});
export type CatalogClosePiece = z.infer<typeof catalogClosePieceSchema>;

export const catalogDetailSchema = catalogCardSchema.extend({
  images: z.array(z.string()),
  sizes: z.array(z.object({ label: z.string(), available: z.boolean() })),
  /** Null under 3 people: the counter is shown from 3. */
  likes: z.number().int().nonnegative().nullable(),
  myItem: z.object({ itemId: z.uuid(), stage: itemStageSchema }).nullable(),
  close: z.array(catalogClosePieceSchema),
  sameShop: z.array(catalogCardSchema),
  sameStyle: z.array(catalogCardSchema),
});
export type CatalogDetail = z.infer<typeof catalogDetailSchema>;

/** `GET /api/catalog/{productId}` query string. */
export const catalogDetailQuerySchema = z.object({ profile: z.uuid().optional() });
export type CatalogDetailQuery = z.infer<typeof catalogDetailQuerySchema>;

export const reportReasonSchema = z.enum(["not_fashion", "shocking", "other"]);
export type ReportReason = z.infer<typeof reportReasonSchema>;
export const reportInputSchema = z.object({ reason: reportReasonSchema });
export type ReportInput = z.infer<typeof reportInputSchema>;
/** How the admin closed a report: the article was hidden from the catalogue, or kept in it. */
export const reportResolutionSchema = z.enum(["hidden", "kept"]);
export type ReportResolution = z.infer<typeof reportResolutionSchema>;

export const MAX_PROFILE_SIZE = 10;
const sizeField = z.string().trim().min(1).max(MAX_PROFILE_SIZE).nullable();
/** « Mes tailles » of a profile. */
export const profileSizesSchema = z.object({
  sizeTop: sizeField,
  sizeBottom: sizeField,
  sizeShoes: sizeField,
});
export type ProfileSizes = z.infer<typeof profileSizesSchema>;

const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** Her size against a product's available sizes, ignoring case and spaces; null without a profile size. */
export function sizeMatches(profileSize: string | null, available: string[]): boolean | null {
  if (profileSize === null || squash(profileSize) === "") return null;
  const wanted = squash(profileSize);
  return available.some((s) => squash(s) === wanted);
}

export type SizeKind = "top" | "bottom" | "shoes";

/** Category slugs that take one of her sizes (the API filters « Ma taille en stock » in SQL from this table). */
export const SIZE_KIND_BY_SLUG: Readonly<Record<string, SizeKind>> = {
  vetements: "top",
  robes: "top",
  "robe-courte": "top",
  "robe-longue": "top",
  hauts: "top",
  "t-shirts": "top",
  "chemises-blouses": "top",
  "pulls-gilets": "top",
  "vestes-manteaux": "top",
  combinaisons: "top",
  "maillots-de-bain": "top",
  "lingerie-nuit": "top",
  bas: "bottom",
  pantalons: "bottom",
  jeans: "bottom",
  jupes: "bottom",
  shorts: "bottom",
  chaussures: "shoes",
  baskets: "shoes",
  "bottines-bottes": "shoes",
  escarpins: "shoes",
  sandales: "shoes",
  ballerines: "shoes",
};

/** Which of her sizes applies to a category (by slug); accessories and bags have none. */
export function sizeKindOf(categorySlug: string | null): SizeKind | null {
  return categorySlug ? (SIZE_KIND_BY_SLUG[categorySlug] ?? null) : null;
}

/** pg-boss queue of the Shopify catalogue imports (nightly, or « Importer tout le catalogue » in the admin). */
export const CATALOGUE_IMPORT_QUEUE = "catalogue-import";
/** One import job: one shop. A job without data plans the night's imports. */
export const catalogueImportJobSchema = z.object({ shopId: z.uuid() });
export type CatalogueImportJob = z.infer<typeof catalogueImportJobSchema>;
/**
 * Options of that queue, the same wherever it is created (the first `createQueue` wins): at most one job queued or
 * running per shop (`singletonKey` = shop id), no retry (a refusal waits for the next night), up to 6 h per import.
 */
export const CATALOGUE_IMPORT_QUEUE_OPTIONS = {
  policy: "exclusive",
  retryLimit: 0,
  expireInSeconds: 6 * 60 * 60,
} as const;
