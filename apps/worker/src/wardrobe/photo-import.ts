import { randomUUID } from "node:crypto";
import type dns from "node:dns";
import { and, type Database, eq, schema } from "@closyria/db";
import type { PhotoImportError } from "@closyria/shared";
import {
  ImageTooLargeError,
  MAX_IMAGE_BYTES,
  normalizeImage,
  type ObjectStore,
  UnsupportedImageError,
} from "@closyria/storage";
import type { AddressPolicy } from "../capture/address-policy";
import { CaptureError } from "../capture/capture-error";
import { safeFetch } from "../capture/safe-fetch";

export type PhotoImportDeps = {
  db: Database;
  store: ObjectStore;
  /** Strict by default (safeFetch); tests allow their local server. */
  policy?: AddressPolicy;
  lookup?: typeof dns.lookup;
  /** Overrides safeFetch's 15 s deadline (tests). */
  timeoutMs?: number;
};

/** The import code of a download or re-encoding failure. */
export function photoImportErrorOf(error: unknown): PhotoImportError {
  if (error instanceof ImageTooLargeError) return "too_large";
  if (error instanceof UnsupportedImageError) return "unsupported";
  if (!(error instanceof CaptureError)) return "failed";
  switch (error.code) {
    case "forbidden_address":
    case "blocked":
      return "blocked";
    case "timeout":
      return "timeout";
    case "too_large":
      return "too_large";
    case "invalid_data":
      return "unsupported";
    case "http_error":
      // An answer with an error status refuses the photo; no answer at all (DNS, connection) is a plain failure.
      return error.httpStatus !== undefined && error.httpStatus >= 400 ? "blocked" : "failed";
    default:
      return "failed";
  }
}

const queued = (importId: string) =>
  and(eq(schema.photoImports.id, importId), eq(schema.photoImports.status, "queued"));

/**
 * Downloads the photo of a `queued` import (safeFetch: address policy, 20 MB, images only; robots.txt does not apply
 * to photos), re-encodes it to WebP and stores it under `users/<userId>/<uuid>.webp`, then marks the import `ready`
 * with what was stored. A failure marks it `failed` with its code and leaves no object behind. An import that is
 * gone or no longer `queued` (a retried job) is left alone.
 */
export async function runPhotoImport(importId: string, deps: PhotoImportDeps): Promise<void> {
  const { db, store, policy, lookup, timeoutMs } = deps;
  const [row] = await db
    .select({ userId: schema.photoImports.userId, url: schema.photoImports.url })
    .from(schema.photoImports)
    .where(queued(importId));
  if (!row) return;

  let image: Awaited<ReturnType<typeof normalizeImage>>;
  try {
    const response = await safeFetch(row.url, {
      accept: "image",
      maxBytes: MAX_IMAGE_BYTES,
      ...(policy ? { policy } : {}),
      ...(lookup ? { lookup } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
    image = await normalizeImage(response.body);
  } catch (error) {
    await db
      .update(schema.photoImports)
      .set({ status: "failed", errorCode: photoImportErrorOf(error), updatedAt: new Date() })
      .where(queued(importId));
    return;
  }

  const key = `users/${row.userId}/${randomUUID()}.webp`;
  try {
    await store.put(key, image.data, image.contentType);
    const updated = await db
      .update(schema.photoImports)
      .set({
        status: "ready",
        mediaKey: key,
        contentType: image.contentType,
        sizeBytes: image.data.length,
        width: image.width,
        height: image.height,
        updatedAt: new Date(),
      })
      .where(queued(importId))
      .returning({ id: schema.photoImports.id });
    // Deleted meanwhile (item purged, import expired): the object would belong to nothing.
    if (updated.length === 0) await store.delete(key);
  } catch (error) {
    // No orphan object, and no import left `queued` for her to wait on: it fails (a DB still down rethrows).
    console.error(`photo import ${importId}: could not store the photo`, error);
    await store.delete(key).catch(() => {});
    await db
      .update(schema.photoImports)
      .set({ status: "failed", errorCode: "failed", updatedAt: new Date() })
      .where(queued(importId));
  }
}
