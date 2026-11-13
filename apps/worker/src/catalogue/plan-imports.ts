import { and, type Database, eq, isNull, schema, sql } from "@closyria/db";
import { CATALOGUE_IMPORT_QUEUE, CATALOGUE_IMPORT_STALE_MS } from "@closyria/shared";

export type ImportQueue = {
  send(queue: string, data: object, options: { singletonKey: string }): Promise<unknown>;
};

/**
 * The night's imports: one job per published Shopify shop with the import on (not merged into another). The shop id
 * is the job's singleton key, so a shop already queued or being imported is not queued twice. Returns how many shops
 * were offered to the queue.
 */
export async function planCatalogueImports(db: Database, queue: ImportQueue, now = new Date()): Promise<number> {
  const shops = await db
    .select({ id: schema.shops.id })
    .from(schema.shops)
    .where(
      and(
        eq(schema.shops.importEnabled, true),
        eq(schema.shops.status, "published"),
        eq(schema.shops.platform, "shopify"),
        isNull(schema.shops.mergedIntoId),
      ),
    );
  let planned = 0;
  const stale = new Date(now.getTime() - CATALOGUE_IMPORT_STALE_MS).toISOString();
  for (const shop of shops) {
    // « En attente » in the admin before the job exists (the worker then writes « running »); an import already
    // under way keeps its state, a dead one is replaced.
    await db
      .update(schema.shops)
      .set({ importState: "queued", importStartedAt: now })
      .where(
        and(
          eq(schema.shops.id, shop.id),
          sql`(${schema.shops.importState} is null or ${schema.shops.importStartedAt} is null
            or ${schema.shops.importStartedAt} < ${stale})`,
        ),
      );
    try {
      await queue.send(CATALOGUE_IMPORT_QUEUE, { shopId: shop.id }, { singletonKey: shop.id });
      planned += 1;
    } catch (error) {
      console.error(`catalogue import: cannot queue shop ${shop.id}`, error);
      await db
        .update(schema.shops)
        .set({ importState: null })
        .where(
          and(
            eq(schema.shops.id, shop.id),
            eq(schema.shops.importState, "queued"),
            eq(schema.shops.importStartedAt, now),
          ),
        );
    }
  }
  return planned;
}
