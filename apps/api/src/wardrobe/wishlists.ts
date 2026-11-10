import { and, asc, type Database, eq, gt, inArray, isNull, or, schema, sql } from "@closyria/db";
import type { GroupOrderStatus, SharedGiftState, SharedWishlistView, WishlistView } from "@closyria/shared";

import { catalogImageUrl } from "../catalog/product-view";
import type { Tx } from "./events";
import { friendNameKeysOf } from "./friend-device";
import { giftStatesForList, wasGiven } from "./gifts";
import { sharedGroupOrderView } from "./group-orders";
import { readLoveLevels } from "./love-levels";
import { opinionsByItem } from "./opinions";

type WishlistRow = typeof schema.wishlists.$inferSelect;

/** Her lists as the API shows them: by position, items in list order, items in the trash left out. */
export async function listWishlistViews(
  db: Database | Tx,
  userId: string,
  onlyId?: string,
  now: Date = new Date(),
): Promise<WishlistView[]> {
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
  // The open or closed group order of each list (at most one, partial unique index).
  const running = await db
    .select({
      wishlistId: schema.groupOrders.wishlistId,
      id: schema.groupOrders.id,
      status: schema.groupOrders.status,
      shopName: schema.shops.name,
    })
    .from(schema.groupOrders)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.groupOrders.shopId))
    .where(and(inArray(schema.groupOrders.wishlistId, ids), inArray(schema.groupOrders.status, ["open", "closed"])));
  const groupOrderOf = new Map(
    running.map((r) => [r.wishlistId, { id: r.id, status: r.status as GroupOrderStatus, shopName: r.shopName }]),
  );
  return rows.map((row) =>
    toWishlistView(
      row,
      members.filter((m) => m.wishlistId === row.id).map((m) => m.itemId),
      newCount.get(row.id) ?? 0,
      now,
      groupOrderOf.get(row.id) ?? null,
    ),
  );
}

/** Today in Paris, `YYYY-MM-DD` (the day of her occasion is a Paris day). */
export const parisDay = (at: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);

/**
 * The reminder « {occasion} est passé … » is due from the day after her occasion (Paris), while gifts are open,
 * until she says « C'est fait » (dismissed) and except for the 7 days after « Plus tard » (snoozed).
 */
export function giftReminderDue(row: WishlistRow, now: Date): boolean {
  return (
    row.allowGifts &&
    row.giftDate !== null &&
    parisDay(now) > row.giftDate &&
    row.giftReminderDismissedAt === null &&
    (row.giftReminderSnoozedUntil === null || row.giftReminderSnoozedUntil <= now)
  );
}

function toWishlistView(
  row: WishlistRow,
  itemIds: string[],
  newOpinions: number,
  now: Date,
  groupOrder: WishlistView["groupOrder"],
): WishlistView {
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
    giftReminderDue: giftReminderDue(row, now),
    groupOrder,
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
  | "id"
  | "name"
  | "userId"
  | "allowOpinions"
  | "showOwnerName"
  | "showOwnerOpinions"
  | "showBudget"
  | "allowGifts"
  | "giftOccasion"
  | "giftDate"
>;

// Narrow: only the public columns. The size, stage and gift marker are for the gifts only (never sent otherwise).
const sharedItemColumns = {
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
  sizeLabel: schema.items.sizeLabel,
  stage: schema.items.stage,
  giftReceivedAt: schema.items.giftReceivedAt,
};

/**
 * `deviceKey` (optional, already validated): the friend's device, so her own gifts show as hers (`mine`) and the
 * items taken off the list that she gives still show to her; likewise her share of the group order. `now`: the
 * clock (the group order's deadline).
 */
export async function loadSharedView(
  db: Database,
  list: SharedList,
  deviceKey: string | null = null,
  viewerIsOwner = false,
  now: Date = new Date(),
): Promise<SharedWishlistView> {
  const onList = await db
    .select(sharedItemColumns)
    .from(schema.wishlistItems)
    .innerJoin(schema.items, eq(schema.items.id, schema.wishlistItems.itemId))
    .innerJoin(schema.products, eq(schema.products.id, schema.items.productId))
    .innerJoin(schema.shops, eq(schema.shops.id, schema.products.shopId))
    .where(and(eq(schema.wishlistItems.wishlistId, list.id), isNull(schema.items.deletedAt)))
    .orderBy(asc(schema.wishlistItems.position), asc(schema.wishlistItems.addedAt), asc(schema.wishlistItems.itemId));
  // Her own link: no state, no name, no device of hers (spec: she never sees who before « Reçu en cadeau »).
  const gifts = viewerIsOwner
    ? new Map<string, SharedGiftState>()
    : list.allowGifts
      ? await giftStatesForList(db, list.id, deviceKey ? await friendNameKeysOf(db, list.id, deviceKey) : null)
      : new Map<string, SharedGiftState>();
  // Taken off the list but given by this device: shown to her only, after the others. Never from the trash.
  const onListIds = new Set(onList.map((m) => m.itemId));
  const removedIds = [...gifts]
    .filter(([itemId, gift]) => gift.state === "removed" && !onListIds.has(itemId))
    .map(([itemId]) => itemId);
  const removed =
    removedIds.length === 0
      ? []
      : await db
          .select(sharedItemColumns)
          .from(schema.items)
          .innerJoin(schema.products, eq(schema.products.id, schema.items.productId))
          .innerJoin(schema.shops, eq(schema.shops.id, schema.products.shopId))
          .where(
            and(
              inArray(schema.items.id, removedIds),
              eq(schema.items.userId, list.userId),
              isNull(schema.items.deletedAt),
            ),
          )
          .orderBy(asc(schema.items.id));
  const given = list.allowGifts ? onList.filter(wasGiven) : [];
  const members = [...(list.allowGifts ? onList.filter((m) => !wasGiven(m)) : onList), ...removed];
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
    viewerIsOwner,
    gifts: list.allowGifts
      ? { open: true, occasion: list.giftOccasion, date: list.giftDate }
      : { open: false, occasion: null, date: null },
    // Her own link has no device of hers: never `mine`.
    groupOrder: await sharedGroupOrderView(db, list, viewerIsOwner ? null : deviceKey, now),
    givenItems: given.map((m) => ({ name: m.name ?? "" })),
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
      gift: list.allowGifts ? (viewerIsOwner ? { state: "hidden" } : (gifts.get(m.itemId) ?? { state: "free" })) : null,
      size: list.allowGifts ? m.sizeLabel : null,
      shopName: m.shopName,
      url: m.url,
    })),
  };
}
