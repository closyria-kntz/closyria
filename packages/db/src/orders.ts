/**
 * « Après la commande »: her ordered articles reaching « Reçu », shared by the worker (a delivery, Task 5) and the API
 * (her « Oui » to « Tu as reçu ta commande ? », Task 6), so that both move them the same way.
 */
import { DEFAULT_RETURN_DAYS, returnDeadline } from "@closyria/shared";
import { type AnyColumn, and, asc, eq, inArray, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
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
 * An order without news (« Tu as reçu ta commande ? », Task 6): none of its parcels delivered and one of its articles
 * at least still « Commandé » (not in the trash). `orderId` is the order's id column (or value) in the outer query.
 */
export function orderAwaitingNews(orderId: AnyColumn | SQL): SQL {
  return sql`(not exists (select 1 from ${schema.parcels} where ${schema.parcels.orderId} = ${orderId} and ${schema.parcels.status} = 'delivered')
    and exists (select 1 from ${schema.orderLines} inner join ${schema.items} on ${schema.items.id} = ${schema.orderLines.itemId}
      where ${schema.orderLines.orderId} = ${orderId} and ${schema.items.deletedAt} is null and ${schema.items.stage} = 'ordered'))`;
}

/**
 * The question asked (at 10 or 20 days) and not answered since, on an order still without news: the order view shows
 * « Oui » / « Pas encore ».
 */
export function receivedQuestionOpen(): SQL {
  const o = schema.orders;
  return sql`(${o.status} = 'confirmed' and ${o.receivedAskedAt} is not null
    and (${o.receivedNotYetAt} is null or ${o.receivedNotYetAt} < coalesce(${o.receivedAskedAgainAt}, ${o.receivedAskedAt}))
    and ${orderAwaitingNews(o.id)})`;
}
