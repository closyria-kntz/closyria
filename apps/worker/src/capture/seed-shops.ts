import { type Database, inArray, schema } from "@closyria/db";
import { STARTING_SHOPS } from "./starting-shops";

/**
 * Inserts the starting shops that do not exist yet (by slug), with their domains. An existing shop is never
 * modified (an admin may have renamed or reconfigured it). Returns how many were added.
 */
export async function seedStartingShops(db: Database): Promise<number> {
  const existing = await db
    .select({ slug: schema.shops.slug })
    .from(schema.shops)
    .where(
      inArray(
        schema.shops.slug,
        STARTING_SHOPS.map((s) => s.slug),
      ),
    );
  const known = new Set(existing.map((s) => s.slug));
  let added = 0;
  for (const shop of STARTING_SHOPS) {
    if (known.has(shop.slug)) continue;
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.shops)
        .values({
          slug: shop.slug,
          name: shop.name,
          status: "published",
          platform: shop.platform,
          captureMode: shop.captureMode,
          listingKind: shop.listingKind,
          testUrl: shop.testUrl,
          isMajorBrand: shop.isMajorBrand,
        })
        .onConflictDoNothing({ target: schema.shops.slug })
        .returning({ id: schema.shops.id });
      if (!row) return; // inserted concurrently by another worker
      const domain = await tx
        .insert(schema.shopDomains)
        .values({ domain: shop.domain, shopId: row.id })
        .onConflictDoNothing()
        .returning({ domain: schema.shopDomains.domain });
      if (domain.length === 0) {
        console.warn(`seed: domain ${shop.domain} is already attached to another shop (starting shop ${shop.slug})`);
      }
      added += 1;
    });
  }
  return added;
}
