import { SHOPIFY_SLOWDOWN_MS, type ShopifySlowdownLevel } from "@closyria/shared";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Database } from "./index";
import { crawlSlowdowns } from "./schema/catalog";

export type ActiveSlowdown = { level: ShopifySlowdownLevel; until: Date };

const SHOPIFY = "shopify";

/**
 * A Shopify shop answered 429 or 430 (« ralentissez »): without a slow-down under way, the import intervals are
 * doubled for 6 h; during one (doubled or nightly), the imports go back to once a night for 24 h from now (never
 * shortened). One statement: two rejections at once still count as two. Returns the state now in force.
 */
export async function recordShopifyRejection(db: Database, at: Date): Promise<ActiveSlowdown> {
  const doubledUntil = new Date(at.getTime() + SHOPIFY_SLOWDOWN_MS.doubled);
  const nightlyUntil = new Date(at.getTime() + SHOPIFY_SLOWDOWN_MS.nightly);
  const active = sql`${crawlSlowdowns.until} > ${at.toISOString()}::timestamptz`;
  const [row] = await db
    .insert(crawlSlowdowns)
    .values({ platform: SHOPIFY, level: "doubled", until: doubledUntil, updatedAt: at })
    .onConflictDoUpdate({
      target: crawlSlowdowns.platform,
      set: {
        level: sql`case when ${active} then 'nightly' else 'doubled' end`,
        until: sql`case when ${active}
          then greatest(${crawlSlowdowns.until}, ${nightlyUntil.toISOString()}::timestamptz)
          else ${doubledUntil.toISOString()}::timestamptz end`,
        updatedAt: at,
      },
    })
    .returning({ level: crawlSlowdowns.level, until: crawlSlowdowns.until });
  if (!row) throw new Error("slow-down not recorded");
  return { level: row.level as ShopifySlowdownLevel, until: row.until };
}

/** The Shopify slow-down in force at `at`, or null when there is none (or it is over). */
export async function readShopifySlowdown(db: Database, at: Date): Promise<ActiveSlowdown | null> {
  const [row] = await db
    .select({ level: crawlSlowdowns.level, until: crawlSlowdowns.until })
    .from(crawlSlowdowns)
    .where(and(eq(crawlSlowdowns.platform, SHOPIFY), gt(crawlSlowdowns.until, at)));
  return row ? { level: row.level as ShopifySlowdownLevel, until: row.until } : null;
}
