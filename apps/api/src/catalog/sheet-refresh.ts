import { and, type Database, desc, eq, inArray, schema, sql } from "@closyria/db";
import { CATALOGUE_SHEET_FRESH_MS } from "@closyria/shared";
import type { CaptureQueue } from "./capture-queue";

const ACTIVE = ["queued", "running"];

/**
 * « Stocks frais », the live check of an open catalogue sheet: when the article was read at the shop more than 15 min
 * ago (or never), asks the worker to read it again through the capture path (a `refresh` capture on `capture-user`,
 * nobody's: no « Derniers liens », no limit of hers). Never for an article out of the catalogue (hidden, removed, shop
 * not published or merged) nor for a shop captured by hand. One at a time per product, whoever opens it, and at most
 * one asked every 15 min (a failed one is not asked again at once). Returns whether a read is under way, so the sheet
 * reads itself again in a few seconds. A queue failure is logged and answers false: the sheet shows what it has.
 */
export async function requestSheetRefresh(
  db: Database,
  queue: CaptureQueue,
  productId: string,
  now: Date,
): Promise<boolean> {
  const [product] = await db
    .select({
      id: schema.products.id,
      shopId: schema.products.shopId,
      url: schema.products.canonicalUrl,
      lastCapturedAt: schema.products.lastCapturedAt,
    })
    .from(schema.products)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.products.shopId))
    .where(
      and(
        eq(schema.products.id, productId),
        sql`${schema.products.hiddenAt} is null and ${schema.products.removedAt} is null`,
        eq(schema.shops.status, "published"),
        sql`${schema.shops.mergedIntoId} is null`,
        eq(schema.shops.captureMode, "auto"),
      ),
    );
  if (!product) return false;
  if (product.lastCapturedAt && now.getTime() - product.lastCapturedAt.getTime() < CATALOGUE_SHEET_FRESH_MS) {
    return false;
  }
  const askedSince = new Date(now.getTime() - CATALOGUE_SHEET_FRESH_MS).toISOString();

  const outcome = await db.transaction(async (tx) => {
    // One capture at a time per product, whoever asks (the lock of `requestProductCapture`).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${product.id}, 0))`);
    const [recent] = await tx
      .select({ status: schema.captures.status })
      .from(schema.captures)
      .where(
        and(
          eq(schema.captures.productId, product.id),
          sql`(${inArray(schema.captures.status, ACTIVE)}
            or (${schema.captures.trigger} = 'refresh' and ${schema.captures.createdAt} >= ${askedSince}::timestamptz))`,
        ),
      )
      .orderBy(desc(schema.captures.createdAt))
      .limit(1);
    if (recent) return { underWay: ACTIVE.includes(recent.status), captureId: null };
    const [capture] = await tx
      .insert(schema.captures)
      .values({
        productId: product.id,
        shopId: product.shopId,
        url: product.url,
        trigger: "refresh",
        requestedBy: null,
        status: "queued",
      })
      .returning({ id: schema.captures.id });
    if (!capture) throw new Error("capture not created");
    return { underWay: true, captureId: capture.id };
  });
  if (!outcome.captureId) return outcome.underWay;

  const captureId = outcome.captureId;
  try {
    if (await queue.refreshProduct(product.id, captureId)) return true;
    // Already sent in this 15-minute window: nothing will run this row.
    await db.delete(schema.captures).where(eq(schema.captures.id, captureId));
    return false;
  } catch (error) {
    console.error(`sheet refresh ${product.id}: cannot queue it`, error);
    await db
      .update(schema.captures)
      .set({ status: "failed", errorCode: "queue_unavailable", finishedAt: now })
      .where(eq(schema.captures.id, captureId));
    return false;
  }
}

/** At most this long on the sheet's answer: past it, the sheet goes out and the refresh carries on. */
export const SHEET_REFRESH_WAIT_MS = 1000;

/** `requestSheetRefresh` without ever failing nor holding the sheet more than `SHEET_REFRESH_WAIT_MS`. */
export async function sheetRefreshing(
  db: Database,
  queue: CaptureQueue,
  productId: string,
  now: Date,
  waitMs = SHEET_REFRESH_WAIT_MS,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<boolean>((resolve) => {
    // Still being asked: it will most likely be under way by the next read.
    timer = setTimeout(() => resolve(true), waitMs);
  });
  const asked = requestSheetRefresh(db, queue, productId, now).catch((error) => {
    console.error(`sheet refresh ${productId} failed`, error);
    return false;
  });
  try {
    return await Promise.race([asked, late]);
  } finally {
    clearTimeout(timer);
  }
}
