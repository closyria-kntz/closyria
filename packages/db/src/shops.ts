/** Finding a shop by its domain, shared by the API (captures, admin) and the worker (order e-mails). */
import { domainCandidates, shopDomain } from "@closyria/shared";
import { eq, inArray } from "drizzle-orm";
import type { Database } from "./index";
import * as schema from "./schema";

export type Shop = typeof schema.shops.$inferSelect;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** The pool, or a transaction (its writes then go in savepoints). */
type Db = Database | Tx;

const MAX_MERGE_HOPS = 10;
const MAX_SLUG_ATTEMPTS = 50;

/** Thrown when a concurrent creation took the domain first. */
export class LostRace extends Error {}

/** The shop owning the most specific known domain of `host`, followed to the shop it was merged into. */
export async function findShopByHost(db: Db, host: string): Promise<Shop | null> {
  const candidates = domainCandidates(host);
  const rows = await db
    .select({ domain: schema.shopDomains.domain, shop: schema.shops })
    .from(schema.shopDomains)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.shopDomains.shopId))
    .where(inArray(schema.shopDomains.domain, candidates));
  const found = candidates.map((d) => rows.find((r) => r.domain === d)).find((r) => r !== undefined);
  let shop = found?.shop ?? null;
  for (let hops = 0; shop?.mergedIntoId && hops < MAX_MERGE_HOPS; hops++) {
    const [next] = await db.select().from(schema.shops).where(eq(schema.shops.id, shop.mergedIntoId));
    if (!next) break;
    shop = next;
  }
  return shop;
}

/**
 * The shop of a canonical product address, found by its domain (or a parent domain, `www.` aside) and
 * followed through `merged_into_id`; otherwise created as `pending`. Creation races end in
 * `on conflict do nothing` and a re-read, never in an error.
 */
export async function findOrCreateShop(db: Database, url: string): Promise<Shop> {
  const host = new URL(url).hostname;
  const existing = await findShopByHost(db, host);
  if (existing) return existing;

  const domain = shopDomain(url);
  const baseSlug = domain.replaceAll(".", "-");
  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
    const slug = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;
    try {
      const created = await db.transaction(async (tx) => {
        const [shop] = await tx
          .insert(schema.shops)
          .values({ name: domain, slug })
          .onConflictDoNothing({ target: schema.shops.slug })
          .returning();
        if (!shop) return null; // the slug is taken
        const [owned] = await tx
          .insert(schema.shopDomains)
          .values({ domain, shopId: shop.id })
          .onConflictDoNothing({ target: schema.shopDomains.domain })
          .returning();
        if (!owned) throw new LostRace(); // someone registered the domain meanwhile: drop our shop
        return shop;
      });
      if (created) return created;
    } catch (error) {
      if (!(error instanceof LostRace)) throw error;
    }
    // Either the slug is taken (by another shop, or by the shop of a concurrent creation of this very
    // domain) or the domain was lost: the domain's owner, if any, is the answer.
    const winner = await findShopByHost(db, host);
    if (winner) return winner;
  }
  throw new Error(`no free slug for ${domain}`);
}
