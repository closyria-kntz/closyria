import { createHash } from "node:crypto";
import { and, type Database, eq, schema } from "@closyria/db";
import { MAX_PRODUCT_IMAGES } from "@closyria/shared";
import { normalizeImage, type ObjectStore } from "@closyria/storage";
import type { AddressPolicy } from "./address-policy";
import { safeFetch } from "./safe-fetch";

const PARALLEL_DOWNLOADS = 4;

export type CopyImagesDeps = { db: Database; store: ObjectStore; policy?: AddressPolicy };

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Copies the photos of a product to object storage (WebP, `products/<productId>/<sha256 of the address>.webp`).
 * Existing rows are kept and a photo already stored (same `source_hash`) is not downloaded again; a product
 * never holds more than 8. A photo that fails is skipped. Photos are not paced and robots.txt does not apply.
 */
export async function copyImages(productId: string, urls: string[], deps: CopyImagesDeps): Promise<void> {
  const { db, store, policy } = deps;
  const existing = await db
    .select({ sourceHash: schema.productImages.sourceHash })
    .from(schema.productImages)
    .where(eq(schema.productImages.productId, productId));
  const known = new Set(existing.map((row) => row.sourceHash));
  let room = MAX_PRODUCT_IMAGES - known.size;

  const wanted: { url: string; hash: string; position: number }[] = [];
  const seen = new Set<string>();
  for (const [position, url] of urls.slice(0, MAX_PRODUCT_IMAGES).entries()) {
    const hash = sha256(url);
    if (seen.has(hash)) continue;
    seen.add(hash);
    if (known.has(hash)) {
      await db
        .update(schema.productImages)
        .set({ position })
        .where(and(eq(schema.productImages.productId, productId), eq(schema.productImages.sourceHash, hash)));
    } else if (room > 0) {
      room -= 1;
      wanted.push({ url, hash, position });
    }
  }

  let next = 0;
  const worker = async () => {
    for (let item = wanted[next++]; item; item = wanted[next++]) {
      try {
        const response = await safeFetch(item.url, { accept: "image", ...(policy ? { policy } : {}) });
        const image = await normalizeImage(response.body);
        const key = `products/${productId}/${item.hash}.webp`;
        await store.put(key, image.data, image.contentType);
        await db
          .insert(schema.productImages)
          .values({
            productId,
            position: item.position,
            key,
            width: image.width,
            height: image.height,
            sourceHash: item.hash,
          })
          .onConflictDoNothing();
      } catch {
        // A photo that cannot be fetched or decoded is skipped; the capture still succeeds.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_DOWNLOADS, wanted.length) }, worker));
}
