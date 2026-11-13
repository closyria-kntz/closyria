import { z } from "zod";
import { itemStageSchema } from "./wardrobe";

/** What a shop can claim, ticked by the admin: used as filters of « Découvrir ». */
export const shopValueSchema = z.enum(["made_in_france", "second_hand", "eco_responsible", "free_returns"]);
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

export const catalogDetailSchema = catalogCardSchema.extend({
  images: z.array(z.string()),
  sizes: z.array(z.object({ label: z.string(), available: z.boolean() })),
  /** Null under 3 people: the counter is shown from 3. */
  likes: z.number().int().nonnegative().nullable(),
  myItem: z.object({ itemId: z.uuid(), stage: itemStageSchema }).nullable(),
  close: z.array(catalogCardSchema),
  sameShop: z.array(catalogCardSchema),
  sameStyle: z.array(catalogCardSchema),
});
export type CatalogDetail = z.infer<typeof catalogDetailSchema>;

export const reportReasonSchema = z.enum(["not_fashion", "shocking", "other"]);
export type ReportReason = z.infer<typeof reportReasonSchema>;
export const reportInputSchema = z.object({ reason: reportReasonSchema });
export type ReportInput = z.infer<typeof reportInputSchema>;

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

const SIZE_KIND_BY_SLUG: Record<string, SizeKind> = {
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
