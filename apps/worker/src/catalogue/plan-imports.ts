import { and, type Database, eq, isNull, schema } from "@closyria/db";
import { CATALOGUE_IMPORT_QUEUE } from "@closyria/shared";

export type ImportQueue = {
  send(queue: string, data: object, options: { singletonKey: string }): Promise<unknown>;
};

/**
 * The night's imports: one job per published Shopify shop with the import on (not merged into another). The shop id
 * is the job's singleton key, so a shop already queued or being imported is not queued twice. Returns how many shops
 * were offered to the queue.
 */
export async function planCatalogueImports(db: Database, queue: ImportQueue): Promise<number> {
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
  for (const shop of shops) {
    try {
      await queue.send(CATALOGUE_IMPORT_QUEUE, { shopId: shop.id }, { singletonKey: shop.id });
      planned += 1;
    } catch (error) {
      console.error(`catalogue import: cannot queue shop ${shop.id}`, error);
    }
  }
  return planned;
}
