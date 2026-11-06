import { type Database, lt, schema } from "@closyria/db";
import { PHOTO_IMPORT_RETENTION_HOURS, RECENT_RETENTION_DAYS } from "@closyria/shared";
import type { ObjectStore } from "@closyria/storage";

/**
 * Purges the short-lived rows: recent products last visited over 90 days ago, and photo imports created over 24 hours
 * ago. A `ready` import still owns its stored object (nobody attached it), so the object goes after the commit; an
 * `attached` one handed its object over to `media`, which is left alone. A store failure is logged, never thrown.
 */
export async function purgeTransient(
  db: Database,
  now: Date,
  store: ObjectStore,
): Promise<{ recents: number; imports: number }> {
  const recentLimit = new Date(now.getTime() - RECENT_RETENTION_DAYS * 86_400_000);
  const importLimit = new Date(now.getTime() - PHOTO_IMPORT_RETENTION_HOURS * 3_600_000);

  const recents = await db
    .delete(schema.recentProducts)
    .where(lt(schema.recentProducts.visitedAt, recentLimit))
    .returning({ productId: schema.recentProducts.productId });

  const removed = await db
    .delete(schema.photoImports)
    .where(lt(schema.photoImports.createdAt, importLimit))
    .returning({ status: schema.photoImports.status, mediaKey: schema.photoImports.mediaKey });
  for (const row of removed) {
    if (row.status !== "ready" || !row.mediaKey) continue;
    try {
      await store.delete(row.mediaKey);
    } catch (error) {
      console.error(`transient purge: could not delete stored object ${row.mediaKey}`, error);
    }
  }
  return { recents: recents.length, imports: removed.length };
}
