import { and, type Database, inArray, lt, ne, schema } from "@closyria/db";

export const STUCK_AFTER_MS = 5 * 60_000;

/**
 * Marks captures stuck in `queued` or `running` for over 5 minutes as `failed` (`timeout`). For a user capture,
 * the product's capture status becomes `failed` unless it is already `ok` or `manual`. Returns the count.
 */
export async function sweepStuckCaptures(db: Database, now: Date): Promise<number> {
  const limit = new Date(now.getTime() - STUCK_AFTER_MS);
  return db.transaction(async (tx) => {
    const stuck = await tx
      .update(schema.captures)
      .set({ status: "failed", errorCode: "timeout", finishedAt: now })
      .where(and(inArray(schema.captures.status, ["queued", "running"]), lt(schema.captures.createdAt, limit)))
      .returning({ trigger: schema.captures.trigger, productId: schema.captures.productId });
    const productIds = stuck.flatMap((c) => (c.trigger === "user" && c.productId ? [c.productId] : []));
    if (productIds.length > 0) {
      await tx
        .update(schema.products)
        .set({ captureStatus: "failed" })
        .where(
          and(
            inArray(schema.products.id, productIds),
            ne(schema.products.captureStatus, "ok"),
            ne(schema.products.captureStatus, "manual"),
          ),
        );
    }
    return stuck.length;
  });
}
