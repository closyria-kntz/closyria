import { and, eq, schema } from "@closyria/db";
import { itemMutationResultSchema, mediaErrorCodes, wardrobeErrorCodes } from "@closyria/shared";
import { MAX_IMAGE_BYTES, ObjectNotFoundError, type ObjectStore } from "@closyria/storage";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type AccessEnv, defineAccess } from "../../access";
import type { WardrobeDeps } from "../../wardrobe/deps";
import { attachPhoto, ownsActiveItem, removePhoto } from "../../wardrobe/item-photos";
import { loadItemView } from "../../wardrobe/item-view";
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

/** `user` access ran first: the session is there. */
function userIdOf(c: Context<AccessEnv>): string {
  const id = c.var.session?.user.id;
  if (!id) throw new Error("me route reached without a session");
  return id;
}

export function itemMediaRoutes(deps: WardrobeDeps & { store: ObjectStore }, pipeline: MediaPipeline) {
  const { db, store } = deps;
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
    .openapi(deleteRoute, async (c) => {
      const userId = userIdOf(c);
      const { id: itemId, mediaId } = c.req.valid("param");
      if (!(await removePhoto(db, store, userId, itemId, mediaId))) return c.json(notFound, 404);
      const item = await loadItemView(db, userId, itemId);
      return item ? c.json({ itemIds: [itemId], undo: null, item }, 200) : c.json(notFound, 404);
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
