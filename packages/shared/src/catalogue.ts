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
  /** Whether her profile has any of « Mes tailles »: without one, « Ma taille en stock » cannot filter. */
  hasSizes: z.boolean(),
});
export type CatalogPage = z.infer<typeof catalogPageSchema>;

/** « Tu as déjà quelque chose de proche »: one of her own pieces (« Reçu » / « Dans mon dressing »), never anyone else's. */
export const catalogClosePieceSchema = z.object({
  itemId: z.uuid(),
  /** Her item's sheet is the one of its product (`/produits/{productId}`); null for a piece without a product. */
  productId: z.uuid().nullable(),
  name: z.string(),
  /** Her cover, else the shop's first photo, else her first own photo (the item card's rule); null without any. */
  imageUrl: z.string().nullable(),
  stage: itemStageSchema,
});
export type CatalogClosePiece = z.infer<typeof catalogClosePieceSchema>;

/** Whether `value` is an absolute http(s) address (never `javascript:`, `data:`…): safe for a link out. */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export const catalogDetailSchema = catalogCardSchema.extend({
  images: z.array(z.string()),
  /** The article's page at the shop (« Voir chez {boutique} », « Partager »): http(s) only. */
  url: z.string().refine(isHttpUrl),
  sizes: z.array(z.object({ label: z.string(), available: z.boolean() })),
  /** Her sizes (« Mes tailles ») for this kind of article, as she typed them; empty when none applies. */
  mySizes: z.array(z.string()),
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

/** Words of a shop's size label that never name a size: « 38 FR », « EU 38 », « Taille 38 », « T38 ». */
const SIZE_NOISE = new Set(["fr", "eu", "eur", "taille", "t", "size"]);
/** « Taille unique » as shops write it (letters only, lowercased): TU, T.U., Taille unique, One size, OS, Unique, U. */
const ONE_SIZE = ["tu", "tailleunique", "onesize", "os", "unique", "u"] as const;

/**
 * Whether a shop's size label means « taille unique » (TU, T.U., Taille unique, One size, OS, Unique, U), whatever
 * the case, spaces and dots; digits count (« U 2 » is not one). Mirrored by the SQL `catalog_is_one_size` (0025).
 */
export function isOneSize(label: string): boolean {
  return (ONE_SIZE as readonly string[]).includes(label.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

/**
 * The sizes a label names, in one comparable form, so that « Ma taille en stock » finds 38 in « 38 FR », « FR 38 »,
 * « EU 38 », « EU38 », « T38 », « T.38 », « Taille 38 », « M (38) », « M - 38 », « 36-38 » or « 36/38 », S and M in
 * « S/M », W28 in « W28 L32 », « W28L32 » or « W 28 L 32 ». Lowercase, without spaces; « 38,5 », « 38.5 » and
 * « 38 1/2 » are « 38.5 »; « XXL » is « 2xl » like « 2XL »; « 1XL » is « XL ». The whole label without spaces is one
 * more token (a size written in a way no rule knows still matches itself). Sorted, without repeats. Mirrored by the
 * SQL function `catalog_size_tokens` (migration 0025): keep both in step (a test of
 * apps/api/src/routes/catalogue.integration.test.ts compares them).
 */
export function sizeTokens(label: string): string[] {
  const text = label
    .replace(/\u00a0/g, " ")
    .toLowerCase()
    .replace(/(\d)\s*,\s*(\d)/g, "$1.$2")
    .replace(/(\d+)(?:\s+1\/2|\s*½)(?!\d)/g, "$1.5")
    .replace(/\b([wlt])\s+(?=\d)/g, "$1");
  const tokens = new Set<string>();
  const whole = text.replace(/\s+/g, "");
  if (whole) tokens.add(whole);
  for (const raw of text.split(/[\s/()|,;+-]+/)) {
    const word = raw.replace(/^\.+|\.+$/g, "");
    if (!word || SIZE_NOISE.has(word)) continue;
    for (const token of wordTokens(word)) tokens.add(token);
  }
  return [...tokens].sort();
}

/** One word of a label as tokens (`sizeTokens`; the same cases as `catalog_size_tokens`). */
function wordTokens(word: string): string[] {
  const number = /^(?:t\.?|taille|eu|fr)?(\d+(?:\.\d+)?)(?:fr|eu)?$/.exec(word);
  if (number?.[1]) return [number[1]];
  const waist = /^(w\d+)(l\d+)$/.exec(word);
  if (waist?.[1] && waist[2]) return [waist[1], waist[2]];
  const xs = /^(x{2,})([sl])$/.exec(word);
  if (xs?.[1] && xs[2]) return [`${xs[1].length}x${xs[2]}`];
  const one = /^1x([sl])$/.exec(word);
  if (one?.[1]) return [`x${one[1]}`];
  return [word];
}

/** Every token of her sizes (`sizeTokens`), sorted, without repeats: what the SQL compares with `&&`. */
export function sizeTokensOf(sizes: readonly string[]): string[] {
  return [...new Set(sizes.flatMap(sizeTokens))].sort();
}

/**
 * Whether one of her sizes is among a product's available sizes (`sizeTokens`: « 38 » finds « 38 FR », « M » finds
 * « S/M »…); null when she has no size for it.
 */
export function sizeMatches(mySizes: readonly string[], available: readonly string[]): boolean | null {
  const wanted = new Set(sizeTokensOf(mySizes));
  if (wanted.size === 0) return null;
  return available.some((label) => sizeTokens(label).some((token) => wanted.has(token)));
}

export type SizeKind = "top" | "bottom" | "shoes";

const range = (from: number, to: number, step = 1) =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => String(from + i * step));
const LETTERS = ["XS", "S", "M", "L", "XL", "XXL"];
/** 35, 35,5, 36… 41,5, 42. */
const SHOE_SIZES = range(35, 41)
  .flatMap((n) => [n, `${n},5`])
  .concat("42");

/** The sizes « Mes tailles » offers as chips (« Une autre taille… » adds her own); spec §3.3. */
export const SIZE_SUGGESTIONS: Readonly<Record<SizeKind, readonly string[]>> = {
  top: [...LETTERS, ...range(32, 48, 2)],
  bottom: [...LETTERS, ...range(24, 34), ...range(36, 48, 2), ...range(24, 34).map((n) => `W${n}`)],
  shoes: SHOE_SIZES,
};

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

/**
 * Which of her sizes applies to each category of the tree: its own slug's kind, else the nearest ancestor's, so a
 * sub-category added by an admin (« Jupe crayon » under « Jupes ») inherits it. Categories without any (accessories,
 * bags) are left out. A cycle in the tree (never written by the admin) stops the walk.
 */
export function sizeKindsByCategory(
  categories: readonly { id: string; parentId: string | null; slug: string }[],
): Map<string, SizeKind> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const kinds = new Map<string, SizeKind>();
  for (const category of categories) {
    const seen = new Set<string>();
    let current: (typeof categories)[number] | undefined = category;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      const kind = sizeKindOf(current.slug);
      if (kind) {
        kinds.set(category.id, kind);
        break;
      }
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return kinds;
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

/** An import queued or running for longer than its job may live (pg-boss expiry, 6 h) is a dead job, not under way. */
export const CATALOGUE_IMPORT_STALE_MS = CATALOGUE_IMPORT_QUEUE_OPTIONS.expireInSeconds * 1000;

export const importStateSchema = z.enum(["queued", "running"]);
export type ImportState = z.infer<typeof importStateSchema>;

/** The import under way as stored on the shop, or null when none is, or when it outlived the job expiry. */
export function liveImportState(state: string | null, startedAt: Date | null, now: Date): ImportState | null {
  const parsed = importStateSchema.safeParse(state);
  if (!parsed.success || !startedAt) return null;
  return now.getTime() - startedAt.getTime() < CATALOGUE_IMPORT_STALE_MS ? parsed.data : null;
}
