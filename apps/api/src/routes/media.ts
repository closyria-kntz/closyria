import { randomUUID } from "node:crypto";
import { type Database, schema } from "@closyria/db";
import { type MediaErrorCode, mediaErrorSchema, uploadedMediaSchema } from "@closyria/shared";
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
import type { Tx } from "../wardrobe/events";

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

type NormalizedImage = Awaited<ReturnType<typeof normalizeImage>>;
type StoredImage = { id: string; key: string; image: NormalizedImage };
/** `attach` refused the photo: rolls the transaction back. */
class Refused extends Error {}

/** What the upload routes share: rate limits, the re-encoding semaphore and the store-and-record step. */
export type MediaPipeline = {
  /** Per-address then per-user rate limits; add them to the route after `user` access. */
  limits: MiddlewareHandler<AccessEnv>[];
  /** Re-encodes one uploaded file to WebP (under the semaphore) and stores it; the error answer when it cannot. */
  ingest(
    userId: string,
    file: File,
  ): Promise<({ ok: true } & StoredImage) | { ok: false; status: 413 | 415 | 503; body: { error: MediaErrorCode } }>;
  /**
   * Inserts the `media` row of a stored object, then runs `attach` in the same transaction; when `attach` answers
   * false nothing is kept and the object is deleted (returns false). The object is also deleted when anything throws.
   */
  record(userId: string, stored: StoredImage, attach?: (tx: Tx) => Promise<boolean>): Promise<boolean>;
};

export function createMediaPipeline(deps: MediaDeps): MediaPipeline {
  const perUser = deps.limits?.perUser ?? MEDIA_LIMITS.perUser;
  const perAddress = deps.limits?.perAddress ?? MEDIA_LIMITS.perAddress;
  const concurrency = { ...MEDIA_LIMITS.concurrency, ...deps.limits?.concurrency };
  const semaphore = deps.semaphore ?? createSemaphore(concurrency);
  const limited = (c: Context<AccessEnv>) => c.json(rateLimited, 429);
  return {
    limits: [
      rateLimit<AccessEnv>(perAddress, limited),
      // `user` access ran first, so the session is there.
      rateLimit<AccessEnv>({ ...perUser, key: (c) => `user:${c.var.session?.user.id ?? ""}` }, limited),
    ],
    async ingest(userId, file) {
      if (file.size > MAX_IMAGE_BYTES) return { ok: false, status: 413, body: tooLarge };
      const release = await semaphore.acquire(concurrency.waitMs);
      if (!release) return { ok: false, status: 503, body: busy };
      let image: NormalizedImage;
      try {
        image = await normalizeImage(Buffer.from(await file.arrayBuffer()));
      } catch (error) {
        if (error instanceof ImageTooLargeError) return { ok: false, status: 413, body: tooLarge };
        if (error instanceof UnsupportedImageError) return { ok: false, status: 415, body: unsupported };
        throw error;
      } finally {
        release();
      }
      const id = randomUUID();
      const key = `users/${userId}/${id}.webp`;
      await deps.store.put(key, image.data, image.contentType);
      return { ok: true, id, key, image };
    },
    async record(userId, stored, attach) {
      try {
        await deps.db.transaction(async (tx) => {
          await tx.insert(schema.media).values({
            id: stored.id,
            userId,
            key: stored.key,
            contentType: stored.image.contentType,
            sizeBytes: stored.image.data.length,
            width: stored.image.width,
            height: stored.image.height,
          });
          if (attach && !(await attach(tx))) throw new Refused();
        });
        return true;
      } catch (error) {
        await deps.store.delete(stored.key).catch(() => {}); // no orphan object; the insert error is the one that matters
        if (error instanceof Refused) return false;
        throw error;
      }
    },
  };
}

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

export function mediaRoutes(deps: MediaDeps, pipeline: MediaPipeline = createMediaPipeline(deps)) {
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalid, 400)),
  });
  const route = uploadRoute(pipeline.limits);

  return app.openapi(route, async (c) => {
    // `user` access: the middleware has answered 401 already when there is no session.
    const userId = c.var.session?.user.id;
    if (!userId) throw new Error("media route reached without a session");
    const { file } = c.req.valid("form");
    const stored = await pipeline.ingest(userId, file);
    if (!stored.ok) return c.json(stored.body, stored.status);
    await pipeline.record(userId, stored);
    const { image } = stored;
    return c.json({ id: stored.id, width: image.width, height: image.height, contentType: image.contentType }, 201);
  });
}
