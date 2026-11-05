import { createHash } from "node:crypto";
import type dns from "node:dns";
import { type Database, eq, schema } from "@closyria/db";
import { MAX_PRODUCT_IMAGES } from "@closyria/shared";
import { normalizeImage, type ObjectStore } from "@closyria/storage";
import type { AddressPolicy } from "./address-policy";
import { safeFetch } from "./safe-fetch";

const PARALLEL_DOWNLOADS = 4;

export type CopyImagesDeps = { db: Database; store: ObjectStore; policy?: AddressPolicy; lookup?: typeof dns.lookup };

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Copies the photos of a product to object storage (WebP, `products/<productId>/<sha256 of the address>.webp`).
 * Existing rows are kept and a photo already stored (same `source_hash`) is not downloaded again; a product
 * never holds more than 8. A photo that fails is skipped. Photos are not paced and robots.txt does not apply.
 */
export async function copyImages(productId: string, urls: string[], deps: CopyImagesDeps): Promise<void> {
  const { db, store, policy, lookup } = deps;
  const existing = await db
    .select({ sourceHash: schema.productImages.sourceHash, position: schema.productImages.position })
    .from(schema.productImages)
    .where(eq(schema.productImages.productId, productId));
  const known = new Set(existing.map((row) => row.sourceHash));
  let room = MAX_PRODUCT_IMAGES - known.size;
  // New photos go after the current ones, in page order, so positions stay unique.
  let nextPosition = existing.reduce((max, row) => Math.max(max, row.position), -1) + 1;

  const wanted: { url: string; hash: string; position: number }[] = [];
  const seen = new Set<string>();
  for (const url of urls.slice(0, MAX_PRODUCT_IMAGES)) {
    const hash = sha256(url);
    if (seen.has(hash) || known.has(hash)) continue;
    seen.add(hash);
    if (room > 0) {
      room -= 1;
      wanted.push({ url, hash, position: nextPosition++ });
    }
  }

  let next = 0;
  const worker = async () => {
    for (let item = wanted[next++]; item; item = wanted[next++]) {
      try {
        const response = await safeFetch(item.url, {
          accept: "image",
          ...(policy ? { policy } : {}),
          ...(lookup ? { lookup } : {}),
        });
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
