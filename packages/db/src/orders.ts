/**
 * « Après la commande »: her ordered articles reaching « Reçu », shared by the worker (a delivery, Task 5) and the API
 * (her « Oui » to « Tu as reçu ta commande ? », Task 6), so that both move them the same way.
 */
import { DEFAULT_RETURN_DAYS, returnDeadline } from "@closyria/shared";
import { and, asc, eq, inArray, isNotNull, isNull, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import type { Database } from "./index";
import * as schema from "./schema";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Her items of the order's lines still « Commandé » (not in the trash, with or without a product) move to « Reçu »
 * (`owned`, the stage « Je l'ai reçu » gives, with its history row at `receivedAt`, no amount), with the return
 * deadline counted from `receivedAt` (the shop's delay, DEFAULT_RETURN_DAYS without one). An item already received
 * without a deadline gets it; one with a deadline keeps it; any other stage (returned, sold…) is left alone.
 * Idempotent. Runs under the order's lock (her profiles, the order, then the items: they are locked here).
 *
 * Returns how many items moved.
 */
export async function receiveOrderItems(
  tx: Tx,
  order: { id: string; userId: string; shopId: string | null },
  receivedAt: Date,
  now: Date,
): Promise<number> {
  const [shop] = order.shopId
    ? await tx
        .select({ returnDays: schema.shops.returnDays })
        .from(schema.shops)
        .where(eq(schema.shops.id, order.shopId))
    : [];
  const deadline = returnDeadline(receivedAt, shop?.returnDays ?? DEFAULT_RETURN_DAYS);
  const linked = tx
    .select({ id: schema.orderLines.itemId })
    .from(schema.orderLines)
    .where(and(eq(schema.orderLines.orderId, order.id), isNotNull(schema.orderLines.itemId)));
  const items = await tx
    .select({ id: schema.items.id, stage: schema.items.stage, returnDeadline: schema.items.returnDeadline })
    .from(schema.items)
    .where(
      and(
        inArray(schema.items.id, linked),
        eq(schema.items.userId, order.userId),
        isNull(schema.items.deletedAt),
        inArray(schema.items.stage, ["ordered", "owned"]),
      ),
    )
    .orderBy(asc(schema.items.id))
    .for("update");
  let moved = 0;
  for (const item of items) {
    if (item.stage === "ordered") {
      await tx
        .update(schema.items)
        .set({ stage: "owned", inOrderDraft: false, returnDeadline: deadline, updatedAt: now })
        .where(eq(schema.items.id, item.id));
      // `owned` counts nothing in the budgets (`spent_cents` null), as the API's stage change.
      await tx.insert(schema.itemEvents).values({
        itemId: item.id,
        type: "stage",
        stage: "owned",
        at: receivedAt,
        amountCents: null,
        spentCents: null,
      });
      moved += 1;
    } else if (item.returnDeadline === null) {
      await tx
        .update(schema.items)
        .set({ returnDeadline: deadline, updatedAt: now })
        .where(eq(schema.items.id, item.id));
    }
  }
  return moved;
}

/**
 * The outer query's order id, qualified. Drizzle writes a column bare (`"id"`) in a query on one table; inside a
 * sub-select on another table that bare name would mean that table's column, so these fragments never use it.
 */
export const OUTER_ORDER_ID: SQL = sql.raw(`"orders"."id"`);

/**
 * An order without news (« Tu as reçu ta commande ? », Task 6): none of its parcels delivered and one of its articles
 * at least still « Commandé » (not in the trash). `orderId` is the order's id in the outer query (qualified).
 */
export function orderAwaitingNews(orderId: SQL = OUTER_ORDER_ID): SQL {
  return sql`(not exists (select 1 from "parcels" as news_p where news_p.order_id = ${orderId} and news_p.status = 'delivered')
    and exists (select 1 from "order_lines" as news_l inner join "items" as news_i on news_i.id = news_l.item_id
      where news_l.order_id = ${orderId} and news_i.deleted_at is null and news_i.stage = 'ordered'))`;
}

/**
 * The question asked (at 10 or 20 days) and not answered since, on an order still without news: the order view shows
 * « Oui » / « Pas encore ». For a query on `orders`.
 */
export function receivedQuestionOpen(): SQL {
  return sql`("orders"."status" = 'confirmed' and "orders"."received_asked_at" is not null
    and ("orders"."received_not_yet_at" is null
      or "orders"."received_not_yet_at" < coalesce("orders"."received_asked_again_at", "orders"."received_asked_at"))
    and ${orderAwaitingNews()})`;
}

/**
 * The shop's name an order shows, in SQL (`orderShopDisplayName` of `packages/shared`): the catalogue's name, except
 * while the shop is still `pending` (named after its domain, never looked at by the admin), when the order's own name
 * (read in the e-mail, or typed) is shown; without a shop, the order's own name. Pass the columns qualified (joined
 * tables, or aliases written out).
 */
export function orderShopNameSql(
  shopName: SQLWrapper,
  shopStatus: SQLWrapper,
  orderShopName: SQLWrapper,
): SQL<string | null> {
  return sql<string | null>`(case when ${shopStatus} = 'pending' and ${orderShopName} is not null then ${orderShopName}
    else coalesce(${shopName}, ${orderShopName}) end)`;
}
