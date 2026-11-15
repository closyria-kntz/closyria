import { and, asc, type Database, desc, eq, inArray, schema, sql } from "@closyria/db";
import type { Carrier, OrderView, ParcelStatus } from "@closyria/shared";
import type { Tx } from "../wardrobe/events";

type OrderRow = typeof schema.orders.$inferSelect;

/** Her orders shown in « Mes commandes »: the newest first, this many at most. */
export const MAX_LISTED_ORDERS = 100;

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** Her orders as the API shows them, in the order of `rows`, with their lines, parcels and last steps. */
async function viewsOf(db: Database | Tx, rows: OrderRow[]): Promise<OrderView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const shopIds = [...new Set(rows.flatMap((r) => (r.shopId ? [r.shopId] : [])))];
  const [shops, lines, parcels] = await Promise.all([
    shopIds.length === 0
      ? []
      : db
          .select({ id: schema.shops.id, name: schema.shops.name, returnsUrl: schema.shops.returnsUrl })
          .from(schema.shops)
          .where(inArray(schema.shops.id, shopIds)),
    db
      .select()
      .from(schema.orderLines)
      .where(inArray(schema.orderLines.orderId, ids))
      .orderBy(asc(schema.orderLines.position), asc(schema.orderLines.id)),
    db
      .select({
        parcel: schema.parcels,
        // The carrier's latest step (« Pris en charge », « Disponible en point relais »…).
        lastEventLabel: sql<string | null>`(
          select ${schema.parcelEvents.label} from ${schema.parcelEvents}
          where ${schema.parcelEvents.parcelId} = ${schema.parcels.id}
          order by ${schema.parcelEvents.at} desc, ${schema.parcelEvents.id} desc limit 1)`,
      })
      .from(schema.parcels)
      .where(inArray(schema.parcels.orderId, ids))
      .orderBy(asc(schema.parcels.createdAt), asc(schema.parcels.id)),
  ]);
  const shopOf = new Map(shops.map((s) => [s.id, s]));
  return rows.map((order): OrderView => {
    const shop = order.shopId ? shopOf.get(order.shopId) : undefined;
    return {
      id: order.id,
      profileId: order.profileId,
      shop: shop ? { id: shop.id, name: shop.name, returnsUrl: shop.returnsUrl } : null,
      shopName: shop?.name ?? order.shopName,
      externalRef: order.externalRef,
      orderedAt: iso(order.orderedAt),
      status: order.status as OrderView["status"],
      source: order.source as OrderView["source"],
      parseMethod: order.parseMethod as OrderView["parseMethod"],
      lines: lines
        .filter((l) => l.orderId === order.id)
        .map((l) => ({
          id: l.id,
          itemId: l.itemId,
          productId: l.productId,
          name: l.name,
          sizeLabel: l.sizeLabel,
          color: l.color,
          quantity: l.quantity,
          priceCents: l.priceCents,
          currency: l.currency,
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
      createdAt: order.createdAt.toISOString(),
    };
  });
}

/** One of her orders (any status), or null when unknown or another account's. */
export async function loadOrderView(db: Database | Tx, userId: string, orderId: string): Promise<OrderView | null> {
  const rows = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.userId, userId)));
  return (await viewsOf(db, rows))[0] ?? null;
}

/** « Mes commandes »: her drafts to validate and her orders, newest first; dismissed ones are not listed. */
export async function listOrderViews(db: Database, userId: string): Promise<OrderView[]> {
  const rows = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.userId, userId), inArray(schema.orders.status, ["draft", "confirmed"])))
    .orderBy(desc(schema.orders.createdAt), desc(schema.orders.id))
    .limit(MAX_LISTED_ORDERS);
  return viewsOf(db, rows);
}
