import { randomUUID } from "node:crypto";
import { and, type Database, eq, inArray, schema } from "@closyria/db";
import type { ObjectStore } from "@closyria/storage";
import type { MediaPipeline } from "../routes/media";
import { type AttachOutcome, attachPhoto } from "./item-photos";
import { lockOwnItem } from "./items";

export type ImportRow = typeof schema.photoImports.$inferSelect;

export type ImportAttacher = {
  /**
   * Attaches the photo of a `ready` import: `media` row, `item_media` row and the import `attached`, in one
   * transaction. The item then the import are locked (the purge locks the item before the imports go with it), and
   * the import is re-read under its lock: a read that comes second finds it attached and changes nothing. The object
   * is never deleted on an error: the import stays `ready` and the next read tries again (the transient purge
   * removes it after 24 h). On a refusal the import fails first, its key cleared, and only then is the object deleted.
   */
  attachImport(row: ImportRow): Promise<AttachOutcome | "superseded">;
  /**
   * Attaches every `ready` import of her items (only those of `itemIds` when given), so a photo imported by link
   * reaches the item even when nobody polled its import (dialog closed, page left). Never throws: an import that
   * cannot be attached now stays `ready` (or fails on a refusal) and the read goes on.
   */
  attachReadyImports(userId: string, itemIds?: string[]): Promise<void>;
};

export function createImportAttacher(deps: {
  db: Database;
  store: ObjectStore;
  pipeline: MediaPipeline;
  now?: () => Date;
}): ImportAttacher {
  const { db, store, pipeline } = deps;
  const now = deps.now ?? (() => new Date());

  async function attachImport(row: ImportRow): Promise<AttachOutcome | "superseded"> {
    const { id, userId, itemId, mediaKey, contentType, sizeBytes, width, height } = row;
    if (mediaKey === null || contentType === null || sizeBytes === null || width === null || height === null) {
      throw new Error(`photo import ${id} is ready without its photo`);
    }
    const result: { outcome: AttachOutcome | "superseded" } = { outcome: "attached" };
    const stored = { id: randomUUID(), key: mediaKey, contentType, sizeBytes, width, height };
    await pipeline.recordStored(
      userId,
      stored,
      async (tx) => {
        result.outcome = await attachPhoto(tx, userId, itemId, stored.id);
        if (result.outcome !== "attached") return false;
        await tx
          .update(schema.photoImports)
          .set({ status: "attached", updatedAt: now() })
          .where(eq(schema.photoImports.id, id));
        return true;
      },
      {
        keepObject: true,
        // Before the `media` row: a second read waits here, then finds the import attached and keeps the object.
        claim: async (tx) => {
          await lockOwnItem(tx, userId, itemId);
          const [locked] = await tx
            .select({ status: schema.photoImports.status })
            .from(schema.photoImports)
            .where(eq(schema.photoImports.id, id))
            .for("update");
          if (locked?.status === "ready") return true;
          result.outcome = "superseded";
          return false;
        },
      },
    );
    if (result.outcome === "item_deleted" || result.outcome === "too_many_photos") {
      // Its stored code is the generic one (the column allows the worker's codes only); the poll answer carries the
      // reason.
      const failed = await db
        .update(schema.photoImports)
        .set({ status: "failed", errorCode: "failed", mediaKey: null, updatedAt: now() })
        .where(and(eq(schema.photoImports.id, id), eq(schema.photoImports.status, "ready")))
        .returning({ id: schema.photoImports.id });
      if (failed.length > 0) {
        await store
          .delete(mediaKey)
          .catch((error) => console.error(`photo import ${id}: refused photo not deleted (${mediaKey})`, error));
      }
    }
    return result.outcome;
  }

  async function attachReadyImports(userId: string, itemIds?: string[]): Promise<void> {
    if (itemIds?.length === 0) return;
    const conditions = [eq(schema.photoImports.userId, userId), eq(schema.photoImports.status, "ready")];
    if (itemIds) conditions.push(inArray(schema.photoImports.itemId, itemIds));
    const rows = await db
      .select()
      .from(schema.photoImports)
      .where(and(...conditions))
      .orderBy(schema.photoImports.createdAt);
    for (const row of rows) {
      try {
        await attachImport(row);
      } catch (error) {
        console.error(`photo import ${row.id}: not attached on item read`, error);
      }
    }
  }

  return { attachImport, attachReadyImports };
}
