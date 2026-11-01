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
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type AccessEnv, defineAccess } from "../access";
import { rateLimit } from "../rate-limit";
import { createSemaphore, type Semaphore } from "../semaphore";

type Window = { max: number; windowMs: number };
type Concurrency = { max: number; maxWaiting: number; waitMs: number };

/**
 * Upload limits (before public launch): 30 photos an hour per user, 60 an hour per client address (a
 * household or office shares one), and at most 2 photos re-encoded at once per API process (~60-80 MB of
 * memory each); up to 8 more wait 5 s for a slot, then get 503 `busy`.
 */
export const MEDIA_LIMITS = {
  perUser: { max: 30, windowMs: 60 * 60 * 1000 },
  perAddress: { max: 60, windowMs: 60 * 60 * 1000 },
  concurrency: { max: 2, maxWaiting: 8, waitMs: 5_000 },
} as const satisfies { perUser: Window; perAddress: Window; concurrency: Concurrency };

export type MediaDeps = {
  db: Database;
  store: ObjectStore;
  /** Overrides of MEDIA_LIMITS (tests). */
  limits?: { perUser?: Window; perAddress?: Window; concurrency?: Partial<Concurrency> };
  /** The re-encoding semaphore; built from the concurrency limits when absent (tests inject one). */
  semaphore?: Semaphore;
};

/** Room for the multipart boundaries and part headers around a file of the maximum size. */
const MULTIPART_OVERHEAD = 64 * 1024;

const tooLarge = { error: "image_too_large" } as const;
const unsupported = { error: "unsupported_image" } as const;
const invalid = { error: "invalid_upload" } as const;
const rateLimited = { error: "rate_limited" } as const;
const busy = { error: "busy" } as const;
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: mediaErrorSchema } },
});

const uploadRoute = (limits: MiddlewareHandler<AccessEnv>[]) =>
  defineAccess(
    createRoute({
      method: "post",
      path: "/media",
      summary: "Upload a photo",
      description:
        "One photo in the `file` field of a multipart/form-data body: JPEG, PNG, WebP or AVIF, 20 MB at most " +
        "(the format is read from the content, not from the file name). It is re-encoded to WebP, longest side " +
        "2048 px, without any metadata (EXIF, GPS, XMP, ICC).",
      // After the session check: the rate limits, then an oversized body is refused while it streams in,
      // before anything is buffered.
      middleware: [
        ...limits,
        bodyLimit({ maxSize: MAX_IMAGE_BYTES + MULTIPART_OVERHEAD, onError: (c) => c.json(tooLarge, 413) }),
      ],
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
        429: errorContent("Too many uploads: 30 an hour per user, 60 per client address (rate_limited)"),
        503: errorContent("Photo processing saturated, try again in a moment (busy)"),
      },
    }),
    "user",
  );

export function mediaRoutes(deps: MediaDeps) {
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalid, 400)),
  });
  const perUser = deps.limits?.perUser ?? MEDIA_LIMITS.perUser;
  const perAddress = deps.limits?.perAddress ?? MEDIA_LIMITS.perAddress;
  const concurrency = { ...MEDIA_LIMITS.concurrency, ...deps.limits?.concurrency };
  const semaphore = deps.semaphore ?? createSemaphore(concurrency);
  const limited = (c: Context<AccessEnv>) => c.json(rateLimited, 429);

  const route = uploadRoute([
    rateLimit<AccessEnv>(perAddress, limited),
    // `user` access ran first, so the session is there.
    rateLimit<AccessEnv>({ ...perUser, key: (c) => `user:${c.var.session?.user.id ?? ""}` }, limited),
  ]);

  return app.openapi(route, async (c) => {
    // `user` access: the middleware has answered 401 already when there is no session.
    const userId = c.var.session?.user.id;
    if (!userId) throw new Error("media route reached without a session");
    const { file } = c.req.valid("form");
    if (file.size > MAX_IMAGE_BYTES) return c.json(tooLarge, 413);

    const release = await semaphore.acquire(concurrency.waitMs);
    if (!release) return c.json(busy, 503);
    let image: Awaited<ReturnType<typeof normalizeImage>>;
    try {
      image = await normalizeImage(Buffer.from(await file.arrayBuffer()));
    } catch (error) {
      if (error instanceof ImageTooLargeError) return c.json(tooLarge, 413);
      if (error instanceof UnsupportedImageError) return c.json(unsupported, 415);
      throw error;
    } finally {
      release();
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
