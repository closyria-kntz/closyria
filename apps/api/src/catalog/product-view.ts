import { asc, type Database, eq, inArray, schema } from "@closyria/db";
import type { ProductView } from "@closyria/shared";

export const catalogImageUrl = (imageId: string) => `/api/catalog-images/${imageId}`;

/** The product as the API shows it (photos by position, sizes by position), or null when it does not exist. */
export async function loadProductView(db: Database, productId: string): Promise<ProductView | null> {
  return (await loadProductViews(db, [productId])).get(productId) ?? null;
}

/** Several products in three queries whatever their number (lists), keyed by id; unknown ids are absent. */
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
  for (const { product, shop } of rows) {
    views.set(product.id, {
      id: product.id,
      shop: { name: shop.name, slug: shop.slug },
      canonicalUrl: product.canonicalUrl,
      name: product.name,
      brand: product.brand,
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
    });
  }
  return views;
}
