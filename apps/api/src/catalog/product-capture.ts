import { and, type Database, desc, eq, inArray, schema, sql } from "@closyria/db";
import type { CaptureStatus } from "@closyria/shared";
import type { CaptureQueue } from "./capture-queue";
import type { Shop } from "./shops";

const FRESH_MS = 24 * 60 * 60 * 1000;

export type CaptureRequest = {
  /** A canonical address (`canonicalizeUrl`) of `shop`. */
  url: string;
  shop: Shop;
  /** Her account; null for a friend on a shared link. */
  requestedBy: string | null;
  now: () => Date;
  /** Runs once the capture row exists, before the queue is asked (her « Derniers liens »). */
  beforeEnqueue?: (productId: string) => Promise<void>;
};

/**
 * The shared product page of `url` (created when new), then a capture for the worker unless the page was captured
 * less than 24 hours ago or the shop is captured by hand. One capture at a time per product, whoever asks. A queue
 * failure leaves the capture `failed`/`queue_unavailable` and throws.
 */
export async function requestProductCapture(
  db: Database,
  queue: CaptureQueue,
  { url, shop, requestedBy, now, beforeEnqueue }: CaptureRequest,
): Promise<{ productId: string; captureId: string; status: CaptureStatus }> {
  // Two people pasting the same new link: one insert wins, the other re-reads.
  await db
    .insert(schema.products)
    .values({ shopId: shop.id, canonicalUrl: url })
    .onConflictDoNothing({ target: schema.products.canonicalUrl });
  const [product] = await db.select().from(schema.products).where(eq(schema.products.canonicalUrl, url));
  if (!product) throw new Error("product vanished after insert");

  const at = now();
  const fresh =
    product.captureStatus === "ok" &&
    product.lastCapturedAt !== null &&
    at.getTime() - product.lastCapturedAt.getTime() < FRESH_MS;
  const base = { productId: product.id, shopId: shop.id, url, trigger: "user", requestedBy } as const;

  const outcome = await db.transaction(async (tx) => {
    // One capture at a time per product, whoever asks.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${product.id}, 0))`);
    if (shop.captureMode === "manual") {
      const [capture] = await tx
        .insert(schema.captures)
        .values({ ...base, status: "skipped_manual", finishedAt: at })
        .returning();
      await tx
        .update(schema.products)
        .set({ captureStatus: "manual", updatedAt: at })
        .where(and(eq(schema.products.id, product.id), inArray(schema.products.captureStatus, ["pending", "failed"])));
      return { capture, enqueue: false };
    }
    if (fresh) {
      const [capture] = await tx
        .insert(schema.captures)
        .values({ ...base, status: "succeeded", dataReady: true, finishedAt: at })
        .returning();
      return { capture, enqueue: false };
    }
    const [active] = await tx
      .select()
      .from(schema.captures)
      .where(and(eq(schema.captures.productId, product.id), inArray(schema.captures.status, ["queued", "running"])))
      .orderBy(desc(schema.captures.createdAt))
      .limit(1);
    if (active) return { capture: active, enqueue: false };
    const [capture] = await tx
      .insert(schema.captures)
      .values({ ...base, status: "queued" })
      .returning();
    return { capture, enqueue: true };
  });
  const { capture } = outcome;
  if (!capture) throw new Error("capture not created");

  if (beforeEnqueue) await beforeEnqueue(product.id);

  if (outcome.enqueue) {
    try {
      await queue.enqueue("capture-user", capture.id);
    } catch (error) {
      // Keep the row: another request may already have been given this capture id. A failed capture
      // does not block the next attempt on this page.
      await db
        .update(schema.captures)
        .set({ status: "failed", errorCode: "queue_unavailable", finishedAt: now() })
        .where(eq(schema.captures.id, capture.id));
      throw error;
    }
  }
  return { productId: product.id, captureId: capture.id, status: capture.status as CaptureStatus };
}
