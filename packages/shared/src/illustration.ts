import { z } from "zod";

// --- Illustrations (catalogue conforme, 2026-11-14): what a card shows instead of a shop's photo. ---

/** The silhouettes of the illustrations, one per kind of article. */
export const ILLUSTRATION_KINDS = [
  "top",
  "dress",
  "bottom",
  "skirt",
  "coat",
  "shoes",
  "bag",
  "accessory",
  "other",
] as const;
export const illustrationKindSchema = z.enum(ILLUSTRATION_KINDS);
export type IllustrationKind = z.infer<typeof illustrationKindSchema>;

/** The illustration of a card: its silhouette, filled with the article's colour (`#RRGGBB`), neutral when null. */
export const catalogIllustrationSchema = z.object({
  kind: illustrationKindSchema,
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullable(),
});
export type CatalogIllustration = z.infer<typeof catalogIllustrationSchema>;

/** Reference category slugs by silhouette (the starting reference, `starting-reference.ts`). */
const ILLUSTRATION_KIND_BY_SLUG: Readonly<Record<string, IllustrationKind>> = {
  vetements: "other",
  hauts: "top",
  "t-shirts": "top",
  "chemises-blouses": "top",
  "pulls-gilets": "top",
  "lingerie-nuit": "top",
  "maillots-de-bain": "top",
  robes: "dress",
  "robe-courte": "dress",
  "robe-longue": "dress",
  combinaisons: "dress",
  bas: "bottom",
  pantalons: "bottom",
  jeans: "bottom",
  shorts: "bottom",
  jupes: "skirt",
  "vestes-manteaux": "coat",
  chaussures: "shoes",
  baskets: "shoes",
  "bottines-bottes": "shoes",
  escarpins: "shoes",
  sandales: "shoes",
  ballerines: "shoes",
  sacs: "bag",
  accessoires: "accessory",
  bijoux: "accessory",
  ceintures: "accessory",
  "echarpes-foulards": "accessory",
  "chapeaux-bonnets": "accessory",
};

/** The silhouette of a category slug; « other » when unknown or unfiled. */
export function illustrationKindOf(categorySlug: string | null): IllustrationKind {
  return categorySlug ? (ILLUSTRATION_KIND_BY_SLUG[categorySlug] ?? "other") : "other";
}

/**
 * The silhouette of each category of the tree: its own slug's, else its nearest known ancestor's (a sub-category an
 * admin added inherits it). Categories with none known are left out (« other »). Same walk as `sizeKindsByCategory`.
 */
export function illustrationKindsByCategory(
  categories: readonly { id: string; parentId: string | null; slug: string }[],
): Map<string, IllustrationKind> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const kinds = new Map<string, IllustrationKind>();
  for (const category of categories) {
    const seen = new Set<string>();
    let current: (typeof categories)[number] | undefined = category;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      const kind = ILLUSTRATION_KIND_BY_SLUG[current.slug];
      if (kind) {
        kinds.set(category.id, kind);
        break;
      }
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return kinds;
}
