import { and, asc, type Database, eq, inArray, isNull, schema } from "@closyria/db";
import type { SharedWishlistView, WishlistView } from "@closyria/shared";
import { loadProductViews } from "../catalog/product-view";
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
  const members = await db
    .select({ productId: schema.items.productId })
    .from(schema.wishlistItems)
    .innerJoin(schema.items, eq(schema.items.id, schema.wishlistItems.itemId))
    .where(and(eq(schema.wishlistItems.wishlistId, list.id), isNull(schema.items.deletedAt)))
    .orderBy(asc(schema.wishlistItems.position), asc(schema.wishlistItems.addedAt), asc(schema.wishlistItems.itemId));
  const products = await loadProductViews(
    db,
    members.flatMap((m) => (m.productId ? [m.productId] : [])),
  );
  return {
    name: list.name,
    items: members.flatMap((m) => {
      const product = m.productId ? products.get(m.productId) : undefined;
      if (!product) return [];
      return [
        {
          name: product.name,
          brand: product.brand,
          priceCents: product.priceCents,
          currency: product.currency,
          imageUrl: product.images[0]?.url ?? null,
          shopName: product.shop.name,
          url: product.canonicalUrl,
        },
      ];
    }),
  };
}
