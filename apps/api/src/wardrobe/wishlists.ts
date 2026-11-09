import { and, asc, type Database, eq, gt, inArray, isNull, or, schema, sql } from "@closyria/db";
import type { SharedWishlistView, WishlistView } from "@closyria/shared";

import { catalogImageUrl } from "../catalog/product-view";
import type { Tx } from "./events";
import { readLoveLevels } from "./love-levels";
import { opinionsByItem } from "./opinions";

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
  const ids = rows.map((r) => r.id);
  // New = written or changed after she last looked (all of them when she never did).
  const counts = await db
    .select({ wishlistId: schema.wishlistOpinions.wishlistId, count: sql<number>`count(*)::int` })
    .from(schema.wishlistOpinions)
    .innerJoin(schema.wishlists, eq(schema.wishlists.id, schema.wishlistOpinions.wishlistId))
    .where(
      and(
        inArray(schema.wishlistOpinions.wishlistId, ids),
        or(
          isNull(schema.wishlists.opinionsSeenAt),
          gt(schema.wishlistOpinions.updatedAt, schema.wishlists.opinionsSeenAt),
        ),
      ),
    )
    .groupBy(schema.wishlistOpinions.wishlistId);
  const newCount = new Map(counts.map((c) => [c.wishlistId, c.count]));
  return rows.map((row) =>
    toWishlistView(
      row,
      members.filter((m) => m.wishlistId === row.id).map((m) => m.itemId),
      newCount.get(row.id) ?? 0,
    ),
  );
}

function toWishlistView(row: WishlistRow, itemIds: string[], newOpinions: number): WishlistView {
  return {
    id: row.id,
    name: row.name,
    itemIds,
    shared: row.shareTokenHash !== null,
    sharedAt: row.sharedAt?.toISOString() ?? null,
    position: row.position,
    allowOpinions: row.allowOpinions,
    showOwnerName: row.showOwnerName,
    showOwnerOpinions: row.showOwnerOpinions,
    showBudget: row.showBudget,
    newOpinions,
    allowGifts: row.allowGifts,
    giftOccasion: row.giftOccasion,
    giftDate: row.giftDate,
    giftReminderDue: false,
  };
}

const imageUrlOf = (image: { id: string } | undefined) => (image ? catalogImageUrl(image.id) : null);

/**
 * The public content of a shared list (G4 + brand and shop name): product data only, read from the catalog. The
 * image is the product's first shop photo, never one of her private photos or her cover. Items in the trash are
 * left out; every other stage (sold included) stays.
 */
export type SharedList = Pick<
  WishlistRow,
  "id" | "name" | "userId" | "allowOpinions" | "showOwnerName" | "showOwnerOpinions" | "showBudget"
>;

export async function loadSharedView(db: Database, list: SharedList): Promise<SharedWishlistView> {
  // Narrow: only the public columns, and the first shop photo of each product (not all images, not the sizes).
  const members = await db
    .select({
      itemId: schema.items.id,
      productId: schema.products.id,
      name: schema.products.name,
      brand: schema.products.brand,
      priceCents: schema.products.priceCents,
      currency: schema.products.currency,
      url: schema.products.canonicalUrl,
      shopName: schema.shops.name,
      loveLevel: schema.items.loveLevel,
      priority: schema.items.priority,
      why: schema.items.why,
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
            width: schema.productImages.width,
            height: schema.productImages.height,
          })
          .from(schema.productImages)
          .where(inArray(schema.productImages.productId, productIds))
          .orderBy(
            asc(schema.productImages.productId),
            asc(schema.productImages.position),
            asc(schema.productImages.id),
          );
  const imageOf = new Map(firstImages.map((i) => [i.productId, i]));
  const opinions = await opinionsByItem(db, list.id, null);
  const levels = await readLoveLevels(db, list.userId);
  let ownerName: string | null = null;
  if (list.showOwnerName) {
    const [owner] = await db
      .select({ name: schema.user.name, isAnonymous: schema.user.isAnonymous })
      .from(schema.user)
      .where(eq(schema.user.id, list.userId));
    // A guest has no name of her own: Better Auth names her « Anonymous », which must never reach her friends.
    ownerName = owner && !owner.isAnonymous ? owner.name.trim().split(/\s+/)[0] || null : null;
  }
  let budget: SharedWishlistView["budget"] = null;
  if (list.showBudget) {
    const [row] = await db
      .select({ amountCents: schema.budgets.amountCents })
      .from(schema.budgets)
      .where(eq(schema.budgets.wishlistId, list.id));
    // Budgets carry no currency of their own: amounts are in euros everywhere in the app.
    budget = row ? { amountCents: row.amountCents, currency: "EUR" } : null;
  }
  return {
    name: list.name,
    ownerName,
    allowOpinions: list.allowOpinions,
    gifts: { open: false, occasion: null, date: null },
    givenItems: [],
    levels,
    budget,
    items: members.map((m) => ({
      itemId: m.itemId,
      ownerOpinion:
        list.showOwnerOpinions && (m.loveLevel !== null || m.priority || m.why)
          ? { level: m.loveLevel, priority: m.priority, why: m.why }
          : null,
      // The public view never says what is new: that is for her.
      opinions: (opinions.get(m.itemId) ?? []).map((o) => ({ ...o, isNew: false })),
      name: m.name,
      brand: m.brand,
      priceCents: m.priceCents,
      currency: m.currency,
      imageUrl: imageUrlOf(imageOf.get(m.productId)),
      imageWidth: imageOf.get(m.productId)?.width ?? null,
      imageHeight: imageOf.get(m.productId)?.height ?? null,
      gift: null,
      size: null,
      shopName: m.shopName,
      url: m.url,
    })),
  };
}
