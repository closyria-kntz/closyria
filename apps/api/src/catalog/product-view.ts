import { asc, type Database, eq, schema } from "@closyria/db";
import type { ProductView } from "@closyria/shared";

export const catalogImageUrl = (imageId: string) => `/api/catalog-images/${imageId}`;

/** The product as the API shows it (photos by position, sizes by position), or null when it does not exist. */
export async function loadProductView(db: Database, productId: string): Promise<ProductView | null> {
  const [row] = await db
    .select({ product: schema.products, shop: schema.shops })
    .from(schema.products)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.products.shopId))
    .where(eq(schema.products.id, productId));
  if (!row) return null;
  const { product, shop } = row;
  const [images, sizes] = await Promise.all([
    db
      .select()
      .from(schema.productImages)
      .where(eq(schema.productImages.productId, productId))
      .orderBy(asc(schema.productImages.position)),
    db
      .select()
      .from(schema.productSizes)
      .where(eq(schema.productSizes.productId, productId))
      .orderBy(asc(schema.productSizes.position)),
  ]);
  return {
    id: product.id,
    shop: { name: shop.name, slug: shop.slug },
    canonicalUrl: product.canonicalUrl,
    name: product.name,
    brand: product.brand,
    currency: product.currency,
    priceCents: product.priceCents,
    compareAtCents: product.compareAtCents,
    sizes: sizes.map((s) => ({
      label: s.label,
      available: s.available,
      ...(s.priceCents === null ? {} : { priceCents: s.priceCents }),
    })),
    images: images.map((i) => ({ id: i.id, url: catalogImageUrl(i.id), width: i.width, height: i.height })),
    source: product.source as ProductView["source"],
    captureStatus: product.captureStatus as ProductView["captureStatus"],
    lastCapturedAt: product.lastCapturedAt?.toISOString() ?? null,
  };
}
