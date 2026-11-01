import { randomUUID } from "node:crypto";
import { type Database, schema } from "@closyria/db";
import { mediaErrorSchema, uploadedMediaSchema } from "@closyria/shared";
import {
  ImageTooLargeError,
  MAX_IMAGE_BYTES,
  normalizeImage,
  type ObjectStore,
  UnsupportedImageError,
} from "@closyria/storage";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { type AccessEnv, defineAccess } from "../access";

export type MediaDeps = { db: Database; store: ObjectStore };

/** Room for the multipart boundaries and part headers around a file of the maximum size. */
const MULTIPART_OVERHEAD = 64 * 1024;

const tooLarge = { error: "image_too_large" } as const;
const unsupported = { error: "unsupported_image" } as const;
const invalid = { error: "invalid_upload" } as const;
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: mediaErrorSchema } },
});

const uploadRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/media",
    summary: "Upload a photo",
    description:
      "One photo in the `file` field of a multipart/form-data body: JPEG, PNG, WebP or AVIF, 20 MB at most " +
      "(the format is read from the content, not from the file name). It is re-encoded to WebP, longest side " +
      "2048 px, without any metadata (EXIF, GPS, XMP, ICC).",
    // Refuses an oversized body while it streams in, before anything is buffered.
    middleware: [bodyLimit({ maxSize: MAX_IMAGE_BYTES + MULTIPART_OVERHEAD, onError: (c) => c.json(tooLarge, 413) })],
    request: {
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
      201: { description: "Stored", content: { "application/json": { schema: uploadedMediaSchema } } },
      400: errorContent("No file in the `file` field (invalid_upload)"),
      413: errorContent("Over 20 MB or too many pixels (image_too_large)"),
      415: errorContent("Not a JPEG, PNG, WebP or AVIF image, HEIC included (unsupported_image)"),
    },
  }),
  "user",
);

export function mediaRoutes(deps: MediaDeps) {
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalid, 400)),
  });

  return app.openapi(uploadRoute, async (c) => {
    // `user` access: the middleware has answered 401 already when there is no session.
    const userId = c.var.session?.user.id;
    if (!userId) throw new Error("media route reached without a session");
    const { file } = c.req.valid("form");
    if (file.size > MAX_IMAGE_BYTES) return c.json(tooLarge, 413);

    let image: Awaited<ReturnType<typeof normalizeImage>>;
    try {
      image = await normalizeImage(Buffer.from(await file.arrayBuffer()));
    } catch (error) {
      if (error instanceof ImageTooLargeError) return c.json(tooLarge, 413);
      if (error instanceof UnsupportedImageError) return c.json(unsupported, 415);
      throw error;
    }

    const id = randomUUID();
    const key = `users/${userId}/${id}.webp`;
    await deps.store.put(key, image.data, image.contentType);
    try {
      await deps.db.insert(schema.media).values({
        id,
        userId,
        key,
        contentType: image.contentType,
        sizeBytes: image.data.length,
        width: image.width,
        height: image.height,
      });
    } catch (error) {
      await deps.store.delete(key).catch(() => {}); // no orphan object; the insert error is the one that matters
      throw error;
    }
    return c.json({ id, width: image.width, height: image.height, contentType: image.contentType }, 201);
  });
}
