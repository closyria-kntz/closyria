import { and, type Database, eq, isNull, schema, sql } from "@closyria/db";
import { CAPTURE_QUEUES } from "@closyria/shared";

export type MonitorQueue = { send(queue: string, data: object): Promise<unknown> };

/**
 * Daily monitoring: one `monitor` capture (no product) per published shop in `auto` mode that has a test page,
 * queued for the worker. Returns how many were queued.
 */
export async function scheduleMonitors(db: Database, queue: MonitorQueue): Promise<number> {
  const shops = await db
    .select({ id: schema.shops.id, testUrl: schema.shops.testUrl })
    .from(schema.shops)
    .where(
      and(
        eq(schema.shops.status, "published"),
        eq(schema.shops.captureMode, "auto"),
        sql`${schema.shops.testUrl} IS NOT NULL`,
        isNull(schema.shops.mergedIntoId),
      ),
    );
  let queued = 0;
  for (const shop of shops) {
    if (!shop.testUrl) continue;
    const [capture] = await db
      .insert(schema.captures)
      .values({ shopId: shop.id, url: shop.testUrl, trigger: "monitor", status: "queued" })
      .returning({ id: schema.captures.id });
    if (!capture) continue;
    try {
      await queue.send(CAPTURE_QUEUES.monitor, { captureId: capture.id });
      queued += 1;
    } catch (error) {
      console.error(`monitor: cannot queue capture ${capture.id}`, error);
      await db
        .update(schema.captures)
        .set({ status: "failed", errorCode: "queue_unavailable", finishedAt: new Date() })
        .where(eq(schema.captures.id, capture.id));
    }
  }
  return queued;
}
