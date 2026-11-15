import {
  and,
  asc,
  type Database,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  receivedQuestionOpen,
  schema,
  sql,
} from "@closyria/db";
import {
  type Carrier,
  type ItemStage,
  type OrderView,
  orderShopDisplayName,
  type ParcelStatus,
  type UnreadEmailView,
} from "@closyria/shared";
import type { Tx } from "../wardrobe/events";

type OrderRow = typeof schema.orders.$inferSelect & { receivedQuestion: boolean };

/** Her orders shown in « Mes commandes »: the newest first, this many at most. */
export const MAX_LISTED_ORDERS = 100;

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** Her orders as the API shows them, in the order of `rows`, with their lines, parcels and last steps. */
async function viewsOf(db: Database | Tx, rows: OrderRow[]): Promise<OrderView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const shopIds = [...new Set(rows.flatMap((r) => (r.shopId ? [r.shopId] : [])))];
  // One after another: `db` may be a transaction, whose single connection runs one query at a time.
  const shops =
    shopIds.length === 0
      ? []
      : await db
          .select({
            id: schema.shops.id,
            name: schema.shops.name,
            status: schema.shops.status,
            returnsUrl: schema.shops.returnsUrl,
          })
          .from(schema.shops)
          .where(inArray(schema.shops.id, shopIds));
  const lines = await db
    .select({
      line: schema.orderLines,
      // Its article's step (null when the line has none, or it is in the trash).
      itemStage: sql<string | null>`case when ${schema.items.deletedAt} is null then ${schema.items.stage} end`,
    })
    .from(schema.orderLines)
    .leftJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
    .where(inArray(schema.orderLines.orderId, ids))
    .orderBy(asc(schema.orderLines.position), asc(schema.orderLines.id));
  const parcels = await db
    .select({
      parcel: schema.parcels,
      // The carrier's latest step (« Pris en charge », « Disponible en point relais »…). Tables named by alias: in a
      // select on one table Drizzle writes its columns without their table, and `"id"` would be the step's own (§10.5).
      lastEventLabel: sql<string | null>`(
        select pe.label from ${schema.parcelEvents} pe
        where pe.parcel_id = "parcels"."id"
        order by pe.at desc, pe.id desc limit 1)`,
    })
    .from(schema.parcels)
    .where(inArray(schema.parcels.orderId, ids))
    .orderBy(asc(schema.parcels.createdAt), asc(schema.parcels.id));
  const shopOf = new Map(shops.map((s) => [s.id, s]));
  return rows.map((order): OrderView => {
    const shop = order.shopId ? shopOf.get(order.shopId) : undefined;
    return {
      id: order.id,
      profileId: order.profileId,
      shop: shop ? { id: shop.id, name: shop.name, returnsUrl: shop.returnsUrl } : null,
      // A shop still pending (named after its domain): the name read in the e-mail, or typed (2026-11-15).
      shopName: orderShopDisplayName(shop, order.shopName, order.shopNameTyped),
      externalRef: order.externalRef,
      orderedAt: iso(order.orderedAt),
      status: order.status as OrderView["status"],
      source: order.source as OrderView["source"],
      parseMethod: order.parseMethod as OrderView["parseMethod"],
      lines: lines
        .filter(({ line }) => line.orderId === order.id)
        .map(({ line: l, itemStage }) => ({
          id: l.id,
          itemId: l.itemId,
          productId: l.productId,
          name: l.name,
          sizeLabel: l.sizeLabel,
          color: l.color,
          quantity: l.quantity,
          priceCents: l.priceCents,
          currency: l.currency,
          itemStage: itemStage as ItemStage | null,
        })),
      parcels: parcels
        .filter((p) => p.parcel.orderId === order.id)
        .map(({ parcel, lastEventLabel }) => ({
          id: parcel.id,
          carrier: parcel.carrier as Carrier | null,
          trackingNumber: parcel.trackingNumber,
          status: parcel.status as ParcelStatus,
          lastEventAt: iso(parcel.lastEventAt),
          lastEventLabel,
          estimatedAt: iso(parcel.estimatedAt),
          deliveredAt: iso(parcel.deliveredAt),
        })),
      receivedQuestion: order.receivedQuestion,
      createdAt: order.createdAt.toISOString(),
    };
  });
}

/** The order's columns, and whether « Tu as reçu ta commande ? » waits for her answer. */
const orderColumns = {
  ...getTableColumns(schema.orders),
  receivedQuestion: sql<boolean>`${receivedQuestionOpen()}`,
};

/** One of her orders (any status), or null when unknown or another account's. */
export async function loadOrderView(db: Database | Tx, userId: string, orderId: string): Promise<OrderView | null> {
  const rows = await db
    .select(orderColumns)
    .from(schema.orders)
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.userId, userId)));
  return (await viewsOf(db, rows))[0] ?? null;
}

/** « Mes commandes »: her drafts to validate and her orders, newest first; dismissed ones are not listed. */
export async function listOrderViews(db: Database, userId: string): Promise<OrderView[]> {
  const rows = await db
    .select(orderColumns)
    .from(schema.orders)
    .where(and(eq(schema.orders.userId, userId), inArray(schema.orders.status, ["draft", "confirmed"])))
    .orderBy(desc(schema.orders.createdAt), desc(schema.orders.id))
    .limit(MAX_LISTED_ORDERS);
  return viewsOf(db, rows);
}

/** Her e-mails nothing could read listed on « Mes commandes » at most. */
export const MAX_LISTED_UNREAD_EMAILS = 20;

/**
 * « On n'a pas su lire cet e-mail »: her failed e-mails still kept (before their purge), not set aside, and with no
 * order typed from them (a dismissed one aside), newest first.
 */
export async function listUnreadEmails(db: Database, userId: string, now: Date): Promise<UnreadEmailView[]> {
  const e = schema.inboundEmails;
  const rows = await db
    .select({ id: e.id, receivedAt: e.receivedAt })
    .from(e)
    .where(
      and(
        eq(e.userId, userId),
        eq(e.status, "failed"),
        isNull(e.dismissedAt),
        sql`${e.purgeAfter} > ${now.toISOString()}::timestamptz`,
        sql`not exists (select 1 from ${schema.orders} o where o.inbound_email_id = ${e.id} and o.status <> 'dismissed')`,
      ),
    )
    .orderBy(desc(e.receivedAt), desc(e.id))
    .limit(MAX_LISTED_UNREAD_EMAILS);
  return rows.map((r) => ({ id: r.id, receivedAt: r.receivedAt.toISOString() }));
}
