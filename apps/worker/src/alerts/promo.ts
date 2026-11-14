import { and, type Database, eq, isNull, schema, sql } from "@closyria/db";
import { isRealDrop, parisDay } from "@closyria/shared";
import { followedItem } from "./detect";

/** A shop is « en promo » with at least this many visible products… */
export const SHOP_PROMO_MIN_PRODUCTS = 5;
/** …and at least this share of them (in %) with a real drop during one import. */
export const SHOP_PROMO_MIN_PERCENT = 30;
/** At most one « {boutique} est en promo » per shop and person over this time. */
export const SHOP_PROMO_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * At the end of a completed import (started at `runStartedAt`): when many of the shop's visible products (not hidden,
 * not removed) had a real drop during it (their last price of the run against their last price before it), one
 * `shop_promo` event for the Paris day's digest goes to each person with a followed wish of the shop, unless she had one
 * for this shop in the last 7 days. Returns how many events were created.
 */
export async function detectShopPromo(db: Database, shopId: string, runStartedAt: Date, at: Date): Promise<number> {
  const visible = and(
    eq(schema.products.shopId, shopId),
    isNull(schema.products.hiddenAt),
    isNull(schema.products.removedAt),
  );
  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.products).where(visible);
  const total = counted?.n ?? 0;
  if (total < SHOP_PROMO_MIN_PRODUCTS) return 0;

  const start = runStartedAt.toISOString();
  const end = at.toISOString();
  const moves = await db.execute<{ before: number | null; after: number | null }>(sql`
    select
      (select h.price_cents from product_history h
        where h.product_id = p.id and h.seen_at < ${start}::timestamptz
        order by h.seen_at desc limit 1) as before,
      (select h.price_cents from product_history h
        where h.product_id = p.id and h.seen_at >= ${start}::timestamptz and h.seen_at <= ${end}::timestamptz
        order by h.seen_at desc limit 1) as after
    from products p
    where p.shop_id = ${shopId} and p.hidden_at is null and p.removed_at is null
      and exists (select 1 from product_history h
        where h.product_id = p.id and h.seen_at >= ${start}::timestamptz and h.seen_at <= ${end}::timestamptz)`);
  const dropped = moves.rows.filter(
    (m) => m.before !== null && m.after !== null && isRealDrop(Number(m.before), Number(m.after)),
  ).length;
  if (dropped * 100 < total * SHOP_PROMO_MIN_PERCENT) return 0;

  const followers = await db
    .selectDistinct({ userId: schema.items.userId })
    .from(schema.items)
    .innerJoin(schema.products, eq(schema.products.id, schema.items.productId))
    .where(
      and(
        eq(schema.products.shopId, shopId),
        followedItem,
        sql`not exists (select 1 from ${schema.alertEvents} e
          where e.user_id = ${schema.items.userId} and e.kind = 'shop_promo' and e.shop_id = ${shopId}
            and e.created_at > ${new Date(at.getTime() - SHOP_PROMO_COOLDOWN_MS).toISOString()}::timestamptz)`,
      ),
    );
  if (followers.length === 0) return 0;
  const digestOn = parisDay(at);
  await db
    .insert(schema.alertEvents)
    .values(followers.map((f) => ({ userId: f.userId, kind: "shop_promo", shopId, digestOn, createdAt: at })));
  return followers.length;
}
