import { and, asc, count, type Database, eq, inArray, schema, sql } from "@closyria/db";
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
 * Whether one more photo could be attached to her item now (a check before work is queued, without lock;
 * `attachPhoto` decides when the photo is there).
 */
export async function photoRoom(
  db: Database,
  userId: string,
  itemId: string,
): Promise<"room" | Exclude<AttachOutcome, "attached">> {
  const [row] = await db
    .select({ deletedAt: schema.items.deletedAt })
    .from(schema.items)
    .where(and(eq(schema.items.id, itemId), eq(schema.items.userId, userId)));
  if (!row) return "not_found";
  if (row.deletedAt) return "item_deleted";
  const [photos] = await db.select({ n: count() }).from(schema.itemMedia).where(eq(schema.itemMedia.itemId, itemId));
  return (photos?.n ?? 0) >= MAX_ITEM_PHOTOS ? "too_many_photos" : "room";
}

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

export type PurgeOutcome = "purged" | "not_found" | "item_not_deleted";

/**
 * Deletes one of her items for good, from the trash only: the item (its history, tags and list places go with it by
 * cascade), its private photos and its photo imports, rows first, in one transaction; the stored objects after the
 * commit, so a store failure (logged) cannot undo the purge. A photo still attached to another item (a merge) is kept.
 */
export async function purgeTrashedItem(
  db: Database,
  store: { delete(key: string): Promise<void> },
  userId: string,
  itemId: string,
): Promise<PurgeOutcome> {
  const keys: string[] = [];
  const outcome = await db.transaction(async (tx): Promise<PurgeOutcome> => {
    const item = await lockOwnItem(tx, userId, itemId);
    if (!item) return "not_found";
    if (!item.deletedAt) return "item_not_deleted";
    const attached = await tx
      .select({ mediaId: schema.itemMedia.mediaId })
      .from(schema.itemMedia)
      .where(eq(schema.itemMedia.itemId, itemId));
    const mediaIds = attached.map((a) => a.mediaId);
    if (mediaIds.length > 0) {
      const removed = await tx
        .delete(schema.media)
        .where(
          and(
            inArray(schema.media.id, mediaIds),
            sql`not exists (select 1 from ${schema.itemMedia} where ${schema.itemMedia.mediaId} = ${schema.media.id} and ${schema.itemMedia.itemId} <> ${itemId})`,
          ),
        )
        .returning({ key: schema.media.key });
      keys.push(...removed.map((r) => r.key));
    }
    // Imports go with the item (cascade); a `ready` one holds an object no row will point to after.
    const imports = await tx
      .delete(schema.photoImports)
      .where(eq(schema.photoImports.itemId, itemId))
      .returning({ status: schema.photoImports.status, key: schema.photoImports.mediaKey });
    for (const { status, key } of imports) if (status === "ready" && key) keys.push(key);
    await tx.delete(schema.items).where(eq(schema.items.id, itemId));
    return "purged";
  });
  for (const key of keys) {
    await store.delete(key).catch((error) => console.error(`purge: could not delete stored object ${key}`, error));
  }
  return outcome;
}
