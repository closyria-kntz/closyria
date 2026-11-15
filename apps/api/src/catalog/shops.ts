import { type Database, findShopByHost, LostRace, type Shop, schema } from "@closyria/db";
import { shopDomain } from "@closyria/shared";

// Moved to packages/db (the worker reads order e-mails with them too); re-exported for the API's callers.
export { findOrCreateShop, findShopByHost, type Shop } from "@closyria/db";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** The pool, or a transaction (its writes then go in savepoints). */
type Db = Database | Tx;

const MAX_SLUG_ATTEMPTS = 50;

export type CreatedShop = { shop: Shop } | { taken: string };

/**
 * A `draft` shop named after the domain of `url` (slug suffixed on collision, like `findOrCreateShop`),
 * or the id of the (surviving) shop that already owns that domain or a parent domain.
 */
export async function createDraftShop(db: Db, url: string): Promise<CreatedShop> {
  const host = new URL(url).hostname;
  const domain = shopDomain(url);
  const baseSlug = domain.replaceAll(".", "-");
  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
    // The domain or a parent domain already belongs to a shop (the surviving one when merged).
    const owner = await findShopByHost(db, host);
    if (owner) return { taken: owner.id };
    const slug = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;
    try {
      const created = await db.transaction(async (tx) => {
        const [shop] = await tx
          .insert(schema.shops)
          .values({ name: domain, slug, status: "draft" })
          .onConflictDoNothing({ target: schema.shops.slug })
          .returning();
        if (!shop) return null; // the slug is taken
        const [owned] = await tx
          .insert(schema.shopDomains)
          .values({ domain, shopId: shop.id })
          .onConflictDoNothing({ target: schema.shopDomains.domain })
          .returning();
        if (!owned) throw new LostRace();
        return shop;
      });
      if (created) return { shop: created };
    } catch (error) {
      if (!(error instanceof LostRace)) throw error;
    }
  }
  throw new Error(`no free slug for ${domain}`);
}
