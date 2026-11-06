import { and, type Database, inArray, isNotNull, lt, notInArray, schema, sql } from "@closyria/db";
import { TRASH_RETENTION_DAYS } from "@closyria/shared";
import type { ObjectStore } from "@closyria/storage";

const BATCH_SIZE = 500;

/**
 * Permanently deletes the items trashed more than 30 days ago, with their private photos and photo imports (rows,
 * then stored objects). Works in batches of 500; each batch is one transaction, and the objects go after the commit so a
 * store failure (logged, never thrown) cannot undo the purge. Returns the number of items purged.
 */
export async function purgeTrash(db: Database, now: Date, store: ObjectStore): Promise<number> {
  const limit = new Date(now.getTime() - TRASH_RETENTION_DAYS * 86_400_000);
  let purged = 0;
  for (;;) {
    const keys: string[] = [];
    const count = await db.transaction(async (tx) => {
      const expired = await tx
        .select({ id: schema.items.id })
        .from(schema.items)
        .where(and(isNotNull(schema.items.deletedAt), lt(schema.items.deletedAt, limit)))
        .limit(BATCH_SIZE)
        .for("update", { skipLocked: true });
      if (expired.length === 0) return 0;
      const ids = expired.map((i) => i.id);

      const attached = await tx
        .select({ mediaId: schema.itemMedia.mediaId })
        .from(schema.itemMedia)
        .where(inArray(schema.itemMedia.itemId, ids));
      const mediaIds = [...new Set(attached.map((a) => a.mediaId))];
      if (mediaIds.length > 0) {
        const removed = await tx
          .delete(schema.media)
          .where(
            and(
              inArray(schema.media.id, mediaIds),
              sql`not exists (select 1 from ${schema.itemMedia} where ${schema.itemMedia.mediaId} = ${schema.media.id} and ${notInArray(schema.itemMedia.itemId, ids)})`,
            ),
          )
          .returning({ key: schema.media.key });
        keys.push(...removed.map((r) => r.key));
      }
      // Imports go with the item (cascade); a `ready` one holds an object no row will point to after.
      const imports = await tx
        .delete(schema.photoImports)
        .where(inArray(schema.photoImports.itemId, ids))
        .returning({ status: schema.photoImports.status, key: schema.photoImports.mediaKey });
      for (const { status, key } of imports) if (status === "ready" && key) keys.push(key);
      await tx
        .delete(schema.items)
        .where(
          and(inArray(schema.items.id, ids), isNotNull(schema.items.deletedAt), lt(schema.items.deletedAt, limit)),
        );
      return ids.length;
    });
    if (count === 0) break;
    purged += count;
    for (const key of keys) {
      try {
        await store.delete(key);
      } catch (error) {
        console.error(`trash purge: could not delete stored object ${key}`, error);
      }
    }
  }
  return purged;
}
