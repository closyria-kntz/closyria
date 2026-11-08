import { asc, type Database, eq, inArray, schema } from "@closyria/db";
import { type ProductTraits, type ProductView, shopDataSchema } from "@closyria/shared";

export const catalogImageUrl = (imageId: string) => `/api/catalog-images/${imageId}`;

/** The product as the API shows it (photos by position, sizes by position), or null when it does not exist. */
export async function loadProductView(db: Database, productId: string): Promise<ProductView | null> {
  return (await loadProductViews(db, [productId])).get(productId) ?? null;
}

/** Several products in a fixed number of queries whatever their number (lists), keyed by id; unknown ids are absent. */
export async function loadProductViews(db: Database, productIds: string[]): Promise<Map<string, ProductView>> {
  const ids = [...new Set(productIds)];
  const views = new Map<string, ProductView>();
  if (ids.length === 0) return views;
  const [rows, images, sizes] = await Promise.all([
    db
      .select({ product: schema.products, shop: schema.shops })
      .from(schema.products)
      .innerJoin(schema.shops, eq(schema.shops.id, schema.products.shopId))
      .where(inArray(schema.products.id, ids)),
    db
      .select()
      .from(schema.productImages)
      .where(inArray(schema.productImages.productId, ids))
      .orderBy(asc(schema.productImages.position), asc(schema.productImages.id)),
    db
      .select()
      .from(schema.productSizes)
      .where(inArray(schema.productSizes.productId, ids))
      .orderBy(asc(schema.productSizes.position)),
  ]);
  const reference = await loadReference(
    db,
    rows.map((r) => r.product),
  );
  for (const { product, shop } of rows) {
    views.set(product.id, {
      id: product.id,
      shop: { name: shop.name, slug: shop.slug },
      canonicalUrl: product.canonicalUrl,
      name: product.name,
      brand: product.brand,
      description: product.description,
      currency: product.currency,
      priceCents: product.priceCents,
      compareAtCents: product.compareAtCents,
      sizes: sizes
        .filter((s) => s.productId === product.id)
        .map((s) => ({
          label: s.label,
          available: s.available,
          ...(s.priceCents === null ? {} : { priceCents: s.priceCents }),
        })),
      images: images
        .filter((i) => i.productId === product.id)
        .map((i) => ({ id: i.id, url: catalogImageUrl(i.id), width: i.width, height: i.height })),
      source: product.source as ProductView["source"],
      captureStatus: product.captureStatus as ProductView["captureStatus"],
      lastCapturedAt: product.lastCapturedAt?.toISOString() ?? null,
      updatedAt: product.updatedAt.toISOString(),
      traits: {
        category: categoryPath(reference.categories, product.categoryId),
        color: product.colorId ? (reference.colors.get(product.colorId) ?? null) : null,
        material: product.materialId ? (reference.materials.get(product.materialId) ?? null) : null,
        pattern: product.patternId ? (reference.patterns.get(product.patternId) ?? null) : null,
        season: product.season as ProductTraits["season"],
        audience: product.audience as ProductTraits["audience"],
        childDetail: product.childDetail as ProductTraits["childDetail"],
      },
      details: shopDetails(product.shopData),
    });
  }
  return views;
}

const detailsSchema = shopDataSchema.shape.details;

/** The stored attributes table, or none when the shop data does not hold a valid one. */
function shopDetails(shopData: Record<string, unknown>): ProductView["details"] {
  const parsed = detailsSchema.safeParse(shopData.details);
  return parsed.success ? (parsed.data ?? []) : [];
}

type CategoryRow = { id: string; parentId: string | null; name: string };
type Reference = {
  categories: Map<string, CategoryRow>;
  colors: Map<string, { name: string; hex: string }>;
  materials: Map<string, string>;
  patterns: Map<string, string>;
};

/** Names from the root down to `id`; empty when unknown. The tree is short; the bound only guards a bad cycle. */
export function categoryPath(categories: Map<string, CategoryRow>, id: string | null): string[] {
  const path: string[] = [];
  for (let current = id ? categories.get(id) : undefined; current && path.length < 10; ) {
    path.unshift(current.name);
    current = current.parentId ? categories.get(current.parentId) : undefined;
  }
  return path;
}

const present = (ids: (string | null)[]) => [...new Set(ids.filter((v): v is string => v !== null))];

/**
 * The labels these products point to, in at most four small queries, none when nothing is filed. Categories are
 * read whole (a short tree) to build the paths.
 */
async function loadReference(
  db: Database,
  products: {
    categoryId: string | null;
    colorId: string | null;
    materialId: string | null;
    patternId: string | null;
  }[],
): Promise<Reference> {
  const colorIds = present(products.map((p) => p.colorId));
  const materialIds = present(products.map((p) => p.materialId));
  const patternIds = present(products.map((p) => p.patternId));
  const anyCategory = products.some((p) => p.categoryId !== null);
  const [categories, colors, materials, patterns] = await Promise.all([
    anyCategory
      ? db
          .select({ id: schema.categories.id, parentId: schema.categories.parentId, name: schema.categories.name })
          .from(schema.categories)
      : [],
    colorIds.length
      ? db
          .select({ id: schema.colors.id, name: schema.colors.name, hex: schema.colors.hex })
          .from(schema.colors)
          .where(inArray(schema.colors.id, colorIds))
      : [],
    materialIds.length
      ? db
          .select({ id: schema.materials.id, name: schema.materials.name })
          .from(schema.materials)
          .where(inArray(schema.materials.id, materialIds))
      : [],
    patternIds.length
      ? db
          .select({ id: schema.patterns.id, name: schema.patterns.name })
          .from(schema.patterns)
          .where(inArray(schema.patterns.id, patternIds))
      : [],
  ]);
  return {
    categories: new Map(categories.map((c) => [c.id, c])),
    colors: new Map(colors.map((c) => [c.id, { name: c.name, hex: c.hex }])),
    materials: new Map(materials.map((m) => [m.id, m.name])),
    patterns: new Map(patterns.map((p) => [p.id, p.name])),
  };
}
