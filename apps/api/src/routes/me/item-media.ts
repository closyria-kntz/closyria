import { randomUUID } from "node:crypto";
import { and, eq, schema } from "@closyria/db";
import {
  itemMutationResultSchema,
  mediaErrorCodes,
  PHOTO_IMPORT_QUEUE,
  type PhotoImportView,
  photoImportAcceptedSchema,
  photoImportRequestSchema,
  photoImportViewErrorSchema,
  photoImportViewSchema,
  wardrobeErrorCodes,
} from "@closyria/shared";
import { MAX_IMAGE_BYTES, ObjectNotFoundError, type ObjectStore } from "@closyria/storage";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type AccessEnv, defineAccess } from "../../access";
import type { CaptureQueue } from "../../catalog/capture-queue";
import type { WardrobeDeps } from "../../wardrobe/deps";
import {
  type AttachOutcome,
  attachPhoto,
  ownsActiveItem,
  photoRoom,
  purgeTrashedItem,
  removePhoto,
} from "../../wardrobe/item-photos";
import { loadItemView } from "../../wardrobe/item-view";
import { lockOwnItem } from "../../wardrobe/items";
import type { MediaPipeline } from "../media";

const notFound = { error: "not_found" } as const;
const invalid = { error: "invalid_upload" } as const;
const invalidRequest = { error: "invalid_request" } as const;
const tooLarge = { error: "image_too_large" } as const;
const MULTIPART_OVERHEAD = 64 * 1024;

const errorSchema = z.object({
  error: z.enum([...new Set([...mediaErrorCodes, ...wardrobeErrorCodes])] as [string, ...string[]]),
});
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});
const itemParams = z.object({ id: z.uuid() });
const photoParams = z.object({ id: z.uuid(), mediaId: z.uuid() });
const importParams = z.object({ id: z.uuid(), importId: z.uuid() });
const mutation = (description: string) => ({
  description,
  content: { "application/json": { schema: itemMutationResultSchema } },
});

const uploadRoute = (pipeline: MediaPipeline) =>
  defineAccess(
    createRoute({
      method: "post",
      path: "/me/items/{id}/media",
      summary: "Attach a private photo to her item",
      description:
        "One photo in the `file` field of a multipart/form-data body, re-encoded like `POST /api/media` (WebP, " +
        "2048 px, no metadata) and counted in the same upload limits. At most 10 private photos per item. " +
        "Private photos are never shown to anyone else. `undo` is null.",
      middleware: [
        ...pipeline.limits,
        bodyLimit({ maxSize: MAX_IMAGE_BYTES + MULTIPART_OVERHEAD, onError: (c) => c.json(tooLarge, 413) }),
      ],
      request: {
        params: itemParams,
        body: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: z.object({
                file: z.instanceof(File).openapi({ type: "string", format: "binary", description: "The photo" }),
              }),
            },
          },
        },
      },
      responses: {
        201: mutation("Attached; the item as it now is"),
        400: errorContent("No file in the `file` field (invalid_upload)"),
        404: errorContent("Unknown or another account's item (not_found)"),
        409: errorContent("Already 10 photos (too_many_photos) or the item is in the trash (item_deleted)"),
        413: errorContent("Over 20 MB or too many pixels (image_too_large)"),
        415: errorContent("Not a JPEG, PNG, WebP or AVIF image (unsupported_image)"),
        429: errorContent("Too many uploads (rate_limited)"),
        503: errorContent("Photo processing saturated (busy)"),
      },
    }),
    "user",
  );

const deleteRoute = defineAccess(
  createRoute({
    method: "delete",
    path: "/me/items/{id}/media/{mediaId}",
    summary: "Remove a private photo",
    description:
      "Deletes the photo and its stored file. When it was the thumbnail, the thumbnail goes back to the default. " +
      "`undo` is null.",
    request: { params: photoParams },
    responses: {
      200: mutation("Removed; the item as it now is"),
      400: errorContent("Malformed id (invalid_request)"),
      404: errorContent("Unknown or another account's item or photo (not_found)"),
    },
  }),
  "user",
);

const purgeRoute = defineAccess(
  createRoute({
    method: "delete",
    path: "/me/items/{id}/purge",
    summary: "Delete a trashed item for good",
    description:
      "Only for an item already in the trash. Deletes the item and its private photos (rows and stored files). " +
      "No undo.",
    request: { params: itemParams },
    responses: {
      204: { description: "Deleted for good" },
      400: errorContent("Malformed id (invalid_request)"),
      404: errorContent("Unknown or another account's item (not_found)"),
      409: errorContent("The item is not in the trash (item_not_deleted)"),
    },
  }),
  "user",
);

const fileRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/media/{id}",
    summary: "One of her private photos",
    description: "The stored WebP, for its owner only; anyone else gets 404.",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: "The photo",
        content: { "image/webp": { schema: z.string().openapi({ format: "binary" }) } },
      },
      404: errorContent("Unknown, malformed or another account's photo (not_found)"),
    },
  }),
  "user",
);

const importRoute = (pipeline: MediaPipeline) =>
  defineAccess(
    createRoute({
      method: "post",
      path: "/me/items/{id}/media/imports",
      summary: "Add a photo to her item from its address",
      description:
        "The worker downloads the photo (public addresses only, 20 MB at most, images only), re-encodes it like an " +
        "upload and stores it; the API never fetches the address itself. Counted in the upload limits. Poll " +
        "`GET /api/me/items/{id}/media/imports/{importId}` for the outcome.",
      middleware: pipeline.limits,
      request: {
        params: itemParams,
        body: { required: true, content: { "application/json": { schema: photoImportRequestSchema } } },
      },
      responses: {
        202: {
          description: "Queued",
          content: { "application/json": { schema: photoImportAcceptedSchema } },
        },
        400: errorContent("Not an http(s) address, or over 2 048 characters (invalid_request)"),
        404: errorContent("Unknown or another account's item (not_found)"),
        409: errorContent("Already 10 photos (too_many_photos) or the item is in the trash (item_deleted)"),
        429: errorContent("Too many uploads (rate_limited)"),
      },
    }),
    "user",
  );

const importStatusRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/items/{id}/media/imports/{importId}",
    summary: "Where a photo import stands",
    description:
      "`queued` while the worker works, `failed` with its reason, or `attached` with the item. The first read after " +
      "the worker is done attaches the photo (once, even with reads at the same time); when the item has reached 10 " +
      "photos or went to the trash meanwhile, the photo is discarded and the answer is `failed` with " +
      "`too_many_photos` or `item_deleted` (later reads say `failed`).",
    request: { params: importParams },
    responses: {
      200: { description: "The import", content: { "application/json": { schema: photoImportViewSchema } } },
      400: errorContent("Malformed id (invalid_request)"),
      404: errorContent("Unknown or another account's item or import (not_found)"),
    },
  }),
  "user",
);

/** `user` access ran first: the session is there. */
function userIdOf(c: Context<AccessEnv>): string {
  const id = c.var.session?.user.id;
  if (!id) throw new Error("me route reached without a session");
  return id;
}

type ImportRow = typeof schema.photoImports.$inferSelect;

export function itemMediaRoutes(
  deps: WardrobeDeps & { store: ObjectStore; queue: CaptureQueue },
  pipeline: MediaPipeline,
) {
  const { db, store, queue } = deps;
  const now = deps.now ?? (() => new Date());

  const findImport = async (userId: string, itemId: string, importId: string) => {
    const [row] = await db
      .select()
      .from(schema.photoImports)
      .where(
        and(
          eq(schema.photoImports.id, importId),
          eq(schema.photoImports.userId, userId),
          eq(schema.photoImports.itemId, itemId),
        ),
      );
    return row;
  };

  /**
   * Attaches the photo of a `ready` import: `media` row, `item_media` row and the import `attached`, in one
   * transaction. The item then the import are locked (the purge locks the item before the imports go with it), and
   * the import is re-read under its lock: a read that comes second finds it attached and changes nothing. The object
   * is never deleted on an error: the import stays `ready` and the next read tries again (the transient purge
   * removes it after 24 h). On a refusal the import fails first, its key cleared, and only then is the object deleted.
   */
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
      // Its stored code is the generic one (the column allows the worker's codes only); this answer carries the reason.
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

  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => {
      if (result.success) return undefined;
      // A bad multipart body is an upload error; a bad id is an invalid request.
      return result.target === "form" ? c.json(invalid, 400) : c.json(invalidRequest, 400);
    },
  });
  const uuid = z.uuid();

  return app
    .openapi(uploadRoute(pipeline), async (c) => {
      const userId = userIdOf(c);
      const { id: itemId } = c.req.valid("param");
      const { file } = c.req.valid("form");
      // Cheap refusal before the photo is re-encoded; the lock below is what counts.
      if (!(await ownsActiveItem(db, userId, itemId))) {
        return c.json(notFound, 404);
      }
      const stored = await pipeline.ingest(userId, file);
      if (!stored.ok) return c.json(stored.body, stored.status);
      const result: { outcome: Awaited<ReturnType<typeof attachPhoto>> } = { outcome: "attached" };
      const kept = await pipeline.record(userId, stored, async (tx) => {
        result.outcome = await attachPhoto(tx, userId, itemId, stored.id);
        return result.outcome === "attached";
      });
      if (!kept) {
        if (result.outcome === "not_found") return c.json(notFound, 404);
        if (result.outcome === "item_deleted") return c.json({ error: "item_deleted" } as const, 409);
        return c.json({ error: "too_many_photos" } as const, 409);
      }
      const item = await loadItemView(db, userId, itemId);
      return item ? c.json({ itemIds: [itemId], undo: null, item }, 201) : c.json(notFound, 404);
    })
    .openapi(importRoute(pipeline), async (c) => {
      const userId = userIdOf(c);
      const { id: itemId } = c.req.valid("param");
      const { url } = c.req.valid("json");
      const room = await photoRoom(db, userId, itemId);
      if (room === "not_found") return c.json(notFound, 404);
      if (room !== "room") return c.json({ error: room }, 409);
      const [row] = await db
        .insert(schema.photoImports)
        .values({ userId, itemId, url })
        .returning({ id: schema.photoImports.id });
      if (!row) throw new Error("photo import not inserted");
      try {
        await queue.enqueue(PHOTO_IMPORT_QUEUE, row.id);
      } catch (error) {
        await db
          .update(schema.photoImports)
          .set({ status: "failed", errorCode: "failed", updatedAt: now() })
          .where(eq(schema.photoImports.id, row.id));
        throw error;
      }
      return c.json({ importId: row.id }, 202);
    })
    .openapi(importStatusRoute, async (c) => {
      const userId = userIdOf(c);
      const { id: itemId, importId } = c.req.valid("param");
      let row = await findImport(userId, itemId, importId);
      if (row?.status === "ready") {
        const outcome = await attachImport(row);
        if (outcome === "not_found") return c.json(notFound, 404);
        if (outcome === "item_deleted" || outcome === "too_many_photos") {
          return c.json({ status: "failed", error: outcome } satisfies PhotoImportView, 200);
        }
        row = await findImport(userId, itemId, importId);
      }
      if (!row) return c.json(notFound, 404);
      if (row.status === "failed") {
        const error = photoImportViewErrorSchema.parse(row.errorCode ?? "failed");
        return c.json({ status: "failed", error } satisfies PhotoImportView, 200);
      }
      if (row.status !== "attached") return c.json({ status: "queued" } satisfies PhotoImportView, 200);
      const item = await loadItemView(db, userId, itemId);
      return item ? c.json({ status: "attached", item } satisfies PhotoImportView, 200) : c.json(notFound, 404);
    })
    .openapi(deleteRoute, async (c) => {
      const userId = userIdOf(c);
      const { id: itemId, mediaId } = c.req.valid("param");
      if (!(await removePhoto(db, store, userId, itemId, mediaId))) return c.json(notFound, 404);
      const item = await loadItemView(db, userId, itemId);
      return item ? c.json({ itemIds: [itemId], undo: null, item }, 200) : c.json(notFound, 404);
    })
    .openapi(purgeRoute, async (c) => {
      const outcome = await purgeTrashedItem(db, store, userIdOf(c), c.req.valid("param").id);
      if (outcome === "not_found") return c.json(notFound, 404);
      if (outcome === "item_not_deleted") return c.json({ error: "item_not_deleted" } as const, 409);
      return c.body(null, 204);
    })
    .openapi(fileRoute, async (c) => {
      const { id } = c.req.valid("param");
      if (!uuid.safeParse(id).success) return c.json(notFound, 404);
      const [row] = await db
        .select({ key: schema.media.key })
        .from(schema.media)
        .where(and(eq(schema.media.id, id), eq(schema.media.userId, userIdOf(c))));
      if (!row) return c.json(notFound, 404);
      let body: Buffer;
      try {
        body = await store.get(row.key);
      } catch (error) {
        if (error instanceof ObjectNotFoundError) return c.json(notFound, 404);
        throw error;
      }
      return c.body(new Uint8Array(body), 200, {
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      });
    });
}
