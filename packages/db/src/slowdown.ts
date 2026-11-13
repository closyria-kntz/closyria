import { SHOPIFY_SLOWDOWN_MS, type ShopifySlowdownLevel } from "@closyria/shared";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Database } from "./index";
import { crawlSlowdowns } from "./schema/catalog";

export type ActiveSlowdown = { level: ShopifySlowdownLevel; until: Date };

const SHOPIFY = "shopify";
/** A 429/430 escalates `doubled` to `nightly` only this long after the doubled window began (one burst is one hit). */
export const SLOWDOWN_ESCALATE_AFTER_MS = 10 * 60_000;
/** A `nightly` window is pushed back at most this often, however many 429/430 arrive. */
export const SLOWDOWN_EXTEND_EVERY_MS = 60 * 60_000;

/**
 * A Shopify shop answered 429 or 430 (« ralentissez »). Without a slow-down in force: intervals doubled for 6 h. During
 * `doubled`: once 10 min have passed since it began, imports go back to once a night for 24 h (`nightly`); earlier hits
 * change nothing (a burst of rejections is one signal). During `nightly`: its end moves to 24 h from now, at most once an
 * hour, never earlier. One statement: concurrent hits cannot both escalate. Returns the state now in force.
 */
export async function recordShopifyRejection(db: Database, at: Date): Promise<ActiveSlowdown> {
  const iso = (ms: number) => sql`${new Date(at.getTime() + ms).toISOString()}::timestamptz`;
  const now = iso(0);
  const t = crawlSlowdowns;
  const active = sql`${t.until} > ${now}`;
  const escalate = sql`(${active} and ${t.level} = 'doubled' and ${t.since} <= ${iso(-SLOWDOWN_ESCALATE_AFTER_MS)})`;
  const extend = sql`(${active} and ${t.level} = 'nightly' and ${t.updatedAt} <= ${iso(-SLOWDOWN_EXTEND_EVERY_MS)})`;
  const [row] = await db
    .insert(t)
    .values({
      platform: SHOPIFY,
      level: "doubled",
      since: at,
      until: new Date(at.getTime() + SHOPIFY_SLOWDOWN_MS.doubled),
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: t.platform,
      set: {
        level: sql`case when not ${active} then 'doubled' when ${escalate} then 'nightly' else ${t.level} end`,
        since: sql`case when not ${active} or ${escalate} then ${now} else ${t.since} end`,
        until: sql`case
          when not ${active} then ${iso(SHOPIFY_SLOWDOWN_MS.doubled)}
          when ${escalate} or ${extend} then greatest(${t.until}, ${iso(SHOPIFY_SLOWDOWN_MS.nightly)})
          else ${t.until} end`,
        updatedAt: sql`case when not ${active} or ${escalate} or ${extend} then ${now} else ${t.updatedAt} end`,
      },
    })
    .returning({ level: t.level, until: t.until });
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
