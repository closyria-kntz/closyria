import { and, asc, type Database, eq, inArray, isNull, schema } from "@closyria/db";
import type { SharedWishlistView, WishlistView } from "@closyria/shared";
import { catalogImageUrl } from "../catalog/product-view";
import type { Tx } from "./events";

type WishlistRow = typeof schema.wishlists.$inferSelect;

/** Her lists as the API shows them: by position, items in list order, items in the trash left out. */
export async function listWishlistViews(db: Database | Tx, userId: string, onlyId?: string): Promise<WishlistView[]> {
  const rows = await db
    .select()
    .from(schema.wishlists)
    .where(
      onlyId
        ? and(eq(schema.wishlists.userId, userId), eq(schema.wishlists.id, onlyId))
        : eq(schema.wishlists.userId, userId),
    )
    .orderBy(asc(schema.wishlists.position), asc(schema.wishlists.createdAt), asc(schema.wishlists.id));
  if (rows.length === 0) return [];
  const members = await db
    .select({ wishlistId: schema.wishlistItems.wishlistId, itemId: schema.wishlistItems.itemId })
    .from(schema.wishlistItems)
    .innerJoin(schema.items, eq(schema.items.id, schema.wishlistItems.itemId))
    .where(
      and(
        inArray(
          schema.wishlistItems.wishlistId,
          rows.map((r) => r.id),
        ),
        isNull(schema.items.deletedAt),
      ),
    )
    .orderBy(asc(schema.wishlistItems.position), asc(schema.wishlistItems.addedAt), asc(schema.wishlistItems.itemId));
  return rows.map((row) =>
    toWishlistView(
      row,
      members.filter((m) => m.wishlistId === row.id).map((m) => m.itemId),
    ),
  );
}

function toWishlistView(row: WishlistRow, itemIds: string[]): WishlistView {
  return {
    id: row.id,
    name: row.name,
    itemIds,
    shared: row.shareTokenHash !== null,
    sharedAt: row.sharedAt?.toISOString() ?? null,
    position: row.position,
  };
}

/**
 * The public content of a shared list (G4 + brand and shop name): product data only, read from the catalog. The
 * image is the product's first shop photo, never one of her private photos or her cover. Items in the trash are
 * left out; every other stage (sold included) stays.
 */
export async function loadSharedView(db: Database, list: { id: string; name: string }): Promise<SharedWishlistView> {
  // Narrow: only the public columns, and the first shop photo of each product (not all images, not the sizes).
  const members = await db
    .select({
      productId: schema.products.id,
      name: schema.products.name,
      brand: schema.products.brand,
      priceCents: schema.products.priceCents,
      currency: schema.products.currency,
      url: schema.products.canonicalUrl,
      shopName: schema.shops.name,
    })
    .from(schema.wishlistItems)
    .innerJoin(schema.items, eq(schema.items.id, schema.wishlistItems.itemId))
    .innerJoin(schema.products, eq(schema.products.id, schema.items.productId))
    .innerJoin(schema.shops, eq(schema.shops.id, schema.products.shopId))
    .where(and(eq(schema.wishlistItems.wishlistId, list.id), isNull(schema.items.deletedAt)))
    .orderBy(asc(schema.wishlistItems.position), asc(schema.wishlistItems.addedAt), asc(schema.wishlistItems.itemId));
  const productIds = [...new Set(members.map((m) => m.productId))];
  const firstImages =
    productIds.length === 0
      ? []
      : await db
          .selectDistinctOn([schema.productImages.productId], {
            productId: schema.productImages.productId,
            id: schema.productImages.id,
          })
          .from(schema.productImages)
          .where(inArray(schema.productImages.productId, productIds))
          .orderBy(
            asc(schema.productImages.productId),
            asc(schema.productImages.position),
            asc(schema.productImages.id),
          );
  const imageOf = new Map(firstImages.map((i) => [i.productId, catalogImageUrl(i.id)]));
  return {
    name: list.name,
    items: members.map((m) => ({
      name: m.name,
      brand: m.brand,
      priceCents: m.priceCents,
      currency: m.currency,
      imageUrl: imageOf.get(m.productId) ?? null,
      shopName: m.shopName,
      url: m.url,
    })),
  };
}
