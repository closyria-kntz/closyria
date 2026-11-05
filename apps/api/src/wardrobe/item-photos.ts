import { and, asc, count, type Database, eq, schema, sql } from "@closyria/db";
import { MAX_ITEM_PHOTOS } from "@closyria/shared";
import type { Tx } from "./events";
import { lockOwnItem } from "./items";

/** Whether the item is hers and active (a cheap check before the photo is re-encoded; `attachPhoto` decides). */
export async function ownsActiveItem(db: Database, userId: string, itemId: string): Promise<boolean> {
  const [row] = await db
    .select({ deletedAt: schema.items.deletedAt })
    .from(schema.items)
    .where(and(eq(schema.items.id, itemId), eq(schema.items.userId, userId)));
  return row !== undefined && row.deletedAt === null;
}

export type AttachOutcome = "attached" | "not_found" | "item_deleted" | "too_many_photos";

/**
 * Attaches a stored photo (its `media` row already inserted in `tx`) as her item's last photo. The item row is locked
 * first, so the count and the insert cannot interleave with another upload on the same item.
 */
export async function attachPhoto(tx: Tx, userId: string, itemId: string, mediaId: string): Promise<AttachOutcome> {
  const item = await lockOwnItem(tx, userId, itemId);
  if (!item) return "not_found";
  if (item.deletedAt) return "item_deleted";
  const [stats] = await tx
    .select({ n: count(), last: sql<number>`coalesce(max(${schema.itemMedia.position}), -1)` })
    .from(schema.itemMedia)
    .where(eq(schema.itemMedia.itemId, itemId));
  if ((stats?.n ?? 0) >= MAX_ITEM_PHOTOS) return "too_many_photos";
  await tx.insert(schema.itemMedia).values({ itemId, mediaId, position: (stats?.last ?? -1) + 1 });
  return "attached";
}

/**
 * Removes one of her item's photos: the `item_media` row, the `media` row and (after commit) the stored object. The
 * cover goes back to null by the foreign key. A missing object is not an error. Null when the item or photo is not hers.
 */
export async function removePhoto(
  db: Database,
  store: { delete(key: string): Promise<void> },
  userId: string,
  itemId: string,
  mediaId: string,
): Promise<boolean> {
  const key = await db.transaction(async (tx) => {
    const item = await lockOwnItem(tx, userId, itemId);
    if (!item) return null;
    const [photo] = await tx
      .select({ key: schema.media.key })
      .from(schema.itemMedia)
      .innerJoin(schema.media, eq(schema.media.id, schema.itemMedia.mediaId))
      .where(
        and(
          eq(schema.itemMedia.itemId, itemId),
          eq(schema.itemMedia.mediaId, mediaId),
          eq(schema.media.userId, userId),
        ),
      )
      .orderBy(asc(schema.itemMedia.position));
    if (!photo) return null;
    await tx.delete(schema.media).where(eq(schema.media.id, mediaId)); // cascades to item_media, nulls the cover
    return photo.key;
  });
  if (key === null) return false;
  await store.delete(key).catch((error) => console.error("photo object not deleted:", error));
  return true;
}
