import { CATALOGUE_IMPORT_PLATFORMS } from "@closyria/shared";
import { and, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import type { Database } from "./index";
import { products, shops } from "./schema/catalog";

/**
 * The shop's catalogue is read by the hourly import (« stocks frais »): published, an importable platform (Shopify,
 * WooCommerce), the import on, not merged into another, not a « grande enseigne ». The planner's rule; its products
 * need no revisit. Reads `shops`.
 */
export const importCoversShop = and(
  eq(shops.importEnabled, true),
  eq(shops.status, "published"),
  inArray(shops.platform, [...CATALOGUE_IMPORT_PLATFORMS]),
  eq(shops.isMajorBrand, false),
  isNull(shops.mergedIntoId),
) as SQL;

/**
 * A shop whose products are never revisited: entered by hand (the « grandes enseignes » that refuse robots), refused or
 * merged, or whose last real capture (any trigger; not a 24 h reuse, not a queue failure) was blocked or disallowed by
 * robots.txt. Its next successful capture (a person pasting a link, the monitor) lifts the last one. Reads `shops`, in a
 * query that selects from it (its columns must come out qualified, `"shops"."id"`, not inside an update of it).
 */
export const shopRevisitBlocked = sql`(${shops.captureMode} = 'manual' or ${shops.status} = 'refused'
  or ${shops.mergedIntoId} is not null
  or coalesce((
    select c.error_code in ('blocked', 'robots_disallowed') from captures c
    where c.shop_id = ${shops.id} and c.status in ('succeeded', 'failed')
      and not (c.status = 'succeeded' and c.method is null)
      and coalesce(c.error_code, '') <> 'queue_unavailable'
    order by c.created_at desc limit 1
  ), false))`;

/** « Suivi impossible pour cette boutique »: neither the import nor a revisit can follow its products. Reads `shops`. */
export const trackingImpossibleSql = sql`(not ${importCoversShop} and ${shopRevisitBlocked})`;

/** Whether a product can be followed for alerts at all (« Suivi impossible pour cette boutique »). False when unknown. */
export async function trackingImpossible(db: Database, productId: string): Promise<boolean> {
  const [row] = await db
    .select({ impossible: sql<boolean>`${trackingImpossibleSql}` })
    .from(products)
    .innerJoin(shops, eq(shops.id, products.shopId))
    .where(eq(products.id, productId));
  return row?.impossible === true;
}
