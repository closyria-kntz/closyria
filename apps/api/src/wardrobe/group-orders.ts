import { and, asc, type Database, desc, eq, gte, inArray, isNull, or, schema, sql } from "@closyria/db";
import {
  canonicalizeUrl,
  computeGroupOrderTotals,
  type FriendLineDelete,
  type FriendLineInput,
  type FriendLinePatch,
  GROUP_ORDER_MAX_LINES,
  type GroupOrderAction,
  type GroupOrderCreate,
  type GroupOrderLineStatus,
  type GroupOrderOrder,
  type GroupOrderOwnLines,
  type GroupOrderPastList,
  type GroupOrderPatch,
  type GroupOrderPerson,
  type GroupOrderStatus,
  type OwnerGroupOrder,
  opinionNameKey,
  type SharedGroupOrder,
  type WardrobeErrorCode,
} from "@closyria/shared";
import type { CaptureQueue } from "../catalog/capture-queue";
import { requestProductCapture } from "../catalog/product-capture";
import { catalogImageUrl } from "../catalog/product-view";
import { listShippingOptions } from "../catalog/shipping-options";
import { findShopByHost, type Shop } from "../catalog/shops";
import { pgCode } from "../pg-code";
import { bulkRefusal, runBulkIn } from "./bulk";
import { trackItemEvents } from "./deps";
import type { Tx } from "./events";
import { ensureFriendDevice, friendNameKeysOf, hashDeviceKey, isFriendDevice, lockFriendName } from "./friend-device";
import { parisDay } from "./wishlists";

type OrderRow = typeof schema.groupOrders.$inferSelect;
type Failure = { error: WardrobeErrorCode };
type Outcome<T> = T | Failure;

const OWNER_KEY = "owner";
const MAX_MERGE_HOPS = 10;
/** An ordered or cancelled group order stays « en cours » on her page this long. */
const RECENT_MS = 30 * 24 * 60 * 60 * 1000;
const RUNNING: GroupOrderStatus[] = ["open", "closed"];

class Refused extends Error {
  constructor(readonly code: WardrobeErrorCode) {
    super(code);
  }
}

/** Runs `work` in a transaction; a `Refused` rolls it back and comes out as `{ error }`. */
async function attempt<T>(db: Database, work: (tx: Tx) => Promise<T>): Promise<Outcome<T>> {
  try {
    return await db.transaction(work);
  } catch (error) {
    if (error instanceof Refused) return { error: error.code };
    throw error;
  }
}

/** Shop id → the shop it ends up in, through `merged_into_id`. */
async function rootShops(db: Database | Tx, shopIds: string[]): Promise<Map<string, string>> {
  const roots = new Map<string, string>(shopIds.map((id) => [id, id]));
  let pending = [...new Set(shopIds)];
  for (let hops = 0; pending.length > 0 && hops < MAX_MERGE_HOPS; hops++) {
    const rows = await db
      .select({ id: schema.shops.id, mergedIntoId: schema.shops.mergedIntoId })
      .from(schema.shops)
      .where(inArray(schema.shops.id, pending));
    const next = new Map(rows.filter((r) => r.mergedIntoId).map((r) => [r.id, r.mergedIntoId as string]));
    for (const [from, at] of roots) {
      const moved = next.get(at);
      if (moved) roots.set(from, moved);
    }
    pending = [...new Set(next.values())];
  }
  return roots;
}

/** Her items on the list (not in the trash), in list order, with their product and the product's shop root. */
async function listItems(db: Database | Tx, wishlistId: string) {
  const rows = await db
    .select({
      itemId: schema.items.id,
      nameOverride: schema.items.nameOverride,
      productId: schema.products.id,
      productName: schema.products.name,
      currency: schema.products.currency,
      shopId: schema.products.shopId,
    })
    .from(schema.wishlistItems)
    .innerJoin(schema.items, eq(schema.items.id, schema.wishlistItems.itemId))
    .innerJoin(schema.products, eq(schema.products.id, schema.items.productId))
    .where(and(eq(schema.wishlistItems.wishlistId, wishlistId), isNull(schema.items.deletedAt)))
    .orderBy(asc(schema.wishlistItems.position), asc(schema.wishlistItems.addedAt), asc(schema.wishlistItems.itemId));
  const roots = await rootShops(
    db,
    rows.map((r) => r.shopId),
  );
  return rows.map((r) => ({ ...r, shopId: roots.get(r.shopId) ?? r.shopId, name: r.nameOverride ?? r.productName }));
}

/** First shop photo of each product. */
async function firstImages(db: Database | Tx, productIds: string[]): Promise<Map<string, string>> {
  if (productIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([schema.productImages.productId], {
      productId: schema.productImages.productId,
      id: schema.productImages.id,
    })
    .from(schema.productImages)
    .where(inArray(schema.productImages.productId, [...new Set(productIds)]))
    .orderBy(asc(schema.productImages.productId), asc(schema.productImages.position), asc(schema.productImages.id));
  return new Map(rows.map((r) => [r.productId, catalogImageUrl(r.id)]));
}

async function sizesOf(db: Database | Tx, productIds: string[]) {
  if (productIds.length === 0) return [];
  return db
    .select({
      productId: schema.productSizes.productId,
      label: schema.productSizes.label,
      priceCents: schema.productSizes.priceCents,
    })
    .from(schema.productSizes)
    .where(inArray(schema.productSizes.productId, [...new Set(productIds)]))
    .orderBy(asc(schema.productSizes.productId), asc(schema.productSizes.position));
}

/** Her group order (through her list), or undefined. `lock`: `FOR UPDATE` on the order row. */
async function ownOrder(db: Database | Tx, userId: string, id: string, lock = false): Promise<OrderRow | undefined> {
  const query = db
    .select({ order: schema.groupOrders })
    .from(schema.groupOrders)
    .innerJoin(schema.wishlists, eq(schema.wishlists.id, schema.groupOrders.wishlistId))
    .where(and(eq(schema.groupOrders.id, id), eq(schema.wishlists.userId, userId)));
  const [row] = lock ? await query.for("update", { of: schema.groupOrders }) : await query;
  return row?.order;
}

async function lockOwn(tx: Tx, userId: string, id: string, writable: boolean): Promise<OrderRow> {
  const order = await ownOrder(tx, userId, id, true);
  if (!order) throw new Refused("not_found");
  if (writable && !RUNNING.includes(order.status as GroupOrderStatus)) throw new Refused("group_order_locked");
  return order;
}

async function ownList(db: Database | Tx, userId: string, wishlistId: string) {
  const [list] = await db
    .select({ id: schema.wishlists.id, shareTokenHash: schema.wishlists.shareTokenHash })
    .from(schema.wishlists)
    .where(and(eq(schema.wishlists.id, wishlistId), eq(schema.wishlists.userId, userId)));
  return list;
}

type LineView = OwnerGroupOrder["people"][number]["lines"][number];

/** Lines with their current unit price; the people in display order (her, then friends by their first line). */
async function readLines(db: Database | Tx, order: OrderRow) {
  const rows = await db
    .select({
      line: schema.groupOrderLines,
      itemName: schema.items.nameOverride,
      productName: schema.products.name,
      productPrice: schema.products.priceCents,
      productUrl: schema.products.canonicalUrl,
      captureStatus: schema.products.captureStatus,
    })
    .from(schema.groupOrderLines)
    .leftJoin(schema.items, eq(schema.items.id, schema.groupOrderLines.itemId))
    .leftJoin(schema.products, eq(schema.products.id, schema.groupOrderLines.productId))
    .where(eq(schema.groupOrderLines.groupOrderId, order.id))
    .orderBy(asc(schema.groupOrderLines.createdAt), asc(schema.groupOrderLines.id));
  const productIds = rows.flatMap((r) => (r.line.productId ? [r.line.productId] : []));
  const [sizes, images] = await Promise.all([sizesOf(db, productIds), firstImages(db, productIds)]);
  const sizePrice = new Map(sizes.map((s) => [`${s.productId}\u0000${s.label}`, s.priceCents]));
  return rows.map((r) => {
    const { line } = r;
    const current =
      line.productId === null
        ? null
        : ((line.sizeLabel === null ? null : sizePrice.get(`${line.productId}\u0000${line.sizeLabel}`)) ??
          r.productPrice);
    const unitPriceCents = line.finalPriceCents ?? line.manualPriceCents ?? current ?? null;
    const status: GroupOrderLineStatus =
      line.productId === null
        ? "manual"
        : r.captureStatus === "pending" && r.productName === null
          ? "reading"
          : "ready";
    const view: LineView = {
      id: line.id,
      name: r.itemName ?? line.manualName ?? r.productName ?? "",
      imageUrl: line.productId ? (images.get(line.productId) ?? null) : null,
      url: line.url ?? r.productUrl ?? null,
      sizeLabel: line.sizeLabel,
      quantity: line.quantity,
      unitPriceCents,
      finalPriceCents: line.finalPriceCents,
      status,
      removedAt: line.removedAt?.toISOString() ?? null,
    };
    return { row: line, view, key: line.buyerNameKey ?? OWNER_KEY };
  });
}

type ReadLine = Awaited<ReturnType<typeof readLines>>[number];

/** People in display order; only those with a line (active or removed). */
function peopleOf(lines: ReadLine[]) {
  const people = new Map<string, { key: string; name: string; isOwner: boolean; lines: ReadLine[]; first: number }>();
  for (const line of lines) {
    const isOwner = line.row.buyerNameKey === null;
    let person = people.get(line.key);
    if (!person) {
      person = { key: line.key, name: line.row.buyerName ?? "", isOwner, lines: [], first: Number.POSITIVE_INFINITY };
      people.set(line.key, person);
    }
    person.lines.push(line);
    if (line.row.removedAt === null) person.first = Math.min(person.first, line.row.createdAt.getTime());
  }
  return [...people.values()].sort((a, b) =>
    a.isOwner !== b.isOwner ? (a.isOwner ? -1 : 1) : a.first - b.first || a.key.localeCompare(b.key),
  );
}

function totalsOf(people: ReturnType<typeof peopleOf>, shippingCents: number, freeFromCents: number | null) {
  const input: GroupOrderPerson[] = people.map((p) => ({
    key: p.key,
    isOwner: p.isOwner,
    linesCents: p.lines
      .filter((l) => l.row.removedAt === null)
      .map((l) => (l.view.unitPriceCents ?? 0) * l.row.quantity),
  }));
  return computeGroupOrderTotals({ people: input, shippingCents, freeFromCents });
}

async function ownerFirstName(db: Database | Tx, wishlistId: string): Promise<string> {
  const [owner] = await db
    .select({ name: schema.user.name, isAnonymous: schema.user.isAnonymous })
    .from(schema.wishlists)
    .innerJoin(schema.user, eq(schema.user.id, schema.wishlists.userId))
    .where(eq(schema.wishlists.id, wishlistId));
  // A guest is « Anonymous » for Better Auth: never shown.
  return owner && !owner.isAnonymous ? (owner.name.trim().split(/\s+/)[0] ?? "") : "";
}

/** The whole group order as she sees it. */
async function toOwnerView(db: Database | Tx, order: OrderRow): Promise<OwnerGroupOrder> {
  const [[shop], lines, payments, items, ownerName] = await Promise.all([
    db
      .select({ id: schema.shops.id, name: schema.shops.name })
      .from(schema.shops)
      .where(eq(schema.shops.id, order.shopId)),
    readLines(db, order),
    db.select().from(schema.groupOrderPayments).where(eq(schema.groupOrderPayments.groupOrderId, order.id)),
    listItems(db, order.wishlistId),
    ownerFirstName(db, order.wishlistId),
  ]);
  if (!shop) throw new Error("group order without its shop");
  const people = peopleOf(lines);
  const totals = totalsOf(people, order.shippingCents, order.freeFromCents);
  const paymentOf = new Map(payments.map((p) => [p.buyerNameKey, p]));
  const own = items.filter((i) => i.shopId === order.shopId);
  const [sizes, images] = await Promise.all([
    sizesOf(
      db,
      own.map((i) => i.productId),
    ),
    firstImages(
      db,
      own.map((i) => i.productId),
    ),
  ]);
  return {
    id: order.id,
    wishlistId: order.wishlistId,
    shop,
    status: order.status as GroupOrderStatus,
    deadline: order.deadline,
    shipping: { label: order.shippingLabel, shippingCents: order.shippingCents, freeFromCents: order.freeFromCents },
    currency: order.currency,
    totals,
    people: people.map((p) => {
      const payment = p.isOwner ? undefined : paymentOf.get(p.key);
      return {
        key: p.key,
        name: p.isOwner ? ownerName : p.name,
        isOwner: p.isOwner,
        lines: p.lines.map((l) => l.view),
        payment: payment ? { amountCents: payment.amountCents, paidAt: payment.paidAt?.toISOString() ?? null } : null,
      };
    }),
    ownItems: own.map((i) => ({
      itemId: i.itemId,
      name: i.name ?? "",
      imageUrl: images.get(i.productId) ?? null,
      sizes: sizes.filter((s) => s.productId === i.productId).map((s) => s.label),
    })),
    orderedAt: order.orderedAt?.toISOString() ?? null,
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
  };
}

async function viewById(db: Database, id: string): Promise<OwnerGroupOrder> {
  const [order] = await db.select().from(schema.groupOrders).where(eq(schema.groupOrders.id, id));
  if (!order) throw new Error("group order vanished");
  return toOwnerView(db, order);
}

/** Write, then answer with the fresh view. */
async function writeThenView(db: Database, work: (tx: Tx) => Promise<string>): Promise<Outcome<OwnerGroupOrder>> {
  const outcome = await attempt(db, work);
  return typeof outcome === "string" ? viewById(db, outcome) : outcome;
}

export async function openGroupOrder(
  db: Database,
  userId: string,
  wishlistId: string,
  input: GroupOrderCreate,
  now: Date,
): Promise<Outcome<OwnerGroupOrder>> {
  const list = await ownList(db, userId, wishlistId);
  if (!list) return { error: "not_found" };
  if (list.shareTokenHash === null) return { error: "not_shared" };
  if (input.deadline !== null && input.deadline < parisDay(now)) return { error: "invalid_request" };
  const items = (await listItems(db, wishlistId)).filter((i) => i.shopId === input.shopId);
  if (items.length === 0) return { error: "shop_not_in_list" };
  let shipping = input.shipping;
  if (input.shippingOptionId !== undefined) {
    const option = (await listShippingOptions(db, input.shopId)).find((o) => o.id === input.shippingOptionId);
    if (!option) return { error: "invalid_request" };
    // Copied: a later change of the option in the admin leaves this order as it is.
    shipping = { label: option.label, shippingCents: option.shippingCents, freeFromCents: option.freeFromCents };
  }
  if (!shipping) return { error: "invalid_request" };
  const currency = items.find((i) => i.currency !== null)?.currency ?? "EUR";
  try {
    const [row] = await db
      .insert(schema.groupOrders)
      .values({
        wishlistId,
        shopId: input.shopId,
        deadline: input.deadline,
        shippingLabel: shipping.label,
        shippingCents: shipping.shippingCents,
        freeFromCents: shipping.freeFromCents,
        currency,
      })
      .returning();
    if (!row) throw new Error("group order not inserted");
    return toOwnerView(db, row);
  } catch (error) {
    // The partial unique index: one open or closed group order per list.
    if (pgCode(error) === "23505") return { error: "already_open" };
    throw error;
  }
}

/** The running one, else the latest ordered or cancelled of the last 30 days. */
export async function currentGroupOrder(
  db: Database,
  userId: string,
  wishlistId: string,
  now: Date,
): Promise<OwnerGroupOrder | null> {
  if (!(await ownList(db, userId, wishlistId))) return null;
  const since = new Date(now.getTime() - RECENT_MS);
  const [row] = await db
    .select()
    .from(schema.groupOrders)
    .where(
      and(
        eq(schema.groupOrders.wishlistId, wishlistId),
        or(
          inArray(schema.groupOrders.status, RUNNING),
          gte(schema.groupOrders.orderedAt, since),
          gte(schema.groupOrders.cancelledAt, since),
        ),
      ),
    )
    .orderBy(
      sql`case when ${schema.groupOrders.status} in ('open', 'closed') then 0 else 1 end`,
      desc(sql`coalesce(${schema.groupOrders.orderedAt}, ${schema.groupOrders.cancelledAt})`),
    )
    .limit(1);
  return row ? toOwnerView(db, row) : null;
}

/** « Commandes groupées passées »: ordered or cancelled, most recent first. Null: not her list. */
export async function pastGroupOrders(
  db: Database,
  userId: string,
  wishlistId: string,
): Promise<GroupOrderPastList | null> {
  if (!(await ownList(db, userId, wishlistId))) return null;
  const rows = await db
    .select()
    .from(schema.groupOrders)
    .where(
      and(eq(schema.groupOrders.wishlistId, wishlistId), inArray(schema.groupOrders.status, ["ordered", "cancelled"])),
    )
    .orderBy(
      desc(sql`coalesce(${schema.groupOrders.orderedAt}, ${schema.groupOrders.cancelledAt})`),
      desc(schema.groupOrders.id),
    );
  const past: GroupOrderPastList["past"] = [];
  for (const row of rows) {
    const view = await toOwnerView(db, row);
    past.push({
      id: row.id,
      shopName: view.shop.name,
      status: view.status,
      orderedAt: view.orderedAt,
      cancelledAt: view.cancelledAt,
      // What was charged: items and shipping (frozen once ordered).
      totalCents: view.totals.totalCents + view.totals.shippingTotalCents,
      unpaidCount: view.people.filter((p) => p.payment !== null && p.payment.paidAt === null).length,
    });
  }
  return { past };
}

export function patchGroupOrder(db: Database, userId: string, id: string, patch: GroupOrderPatch, now: Date) {
  return writeThenView(db, async (tx) => {
    await lockOwn(tx, userId, id, true);
    if (patch.deadline != null && patch.deadline < parisDay(now)) throw new Refused("invalid_request");
    await tx
      .update(schema.groupOrders)
      .set({
        ...(patch.deadline === undefined ? {} : { deadline: patch.deadline }),
        ...(patch.shipping === undefined
          ? {}
          : {
              shippingLabel: patch.shipping.label,
              shippingCents: patch.shipping.shippingCents,
              freeFromCents: patch.shipping.freeFromCents,
            }),
        updatedAt: now,
      })
      .where(eq(schema.groupOrders.id, id));
    return id;
  });
}

const TRANSITIONS: Record<GroupOrderAction["action"], { from: GroupOrderStatus[]; to: GroupOrderStatus }> = {
  close: { from: ["open"], to: "closed" },
  reopen: { from: ["closed"], to: "open" },
  cancel: { from: ["open", "closed"], to: "cancelled" },
};

export function actOnGroupOrder(
  db: Database,
  userId: string,
  id: string,
  action: GroupOrderAction["action"],
  now: Date,
) {
  return writeThenView(db, async (tx) => {
    const order = await lockOwn(tx, userId, id, false);
    const transition = TRANSITIONS[action];
    if (!transition.from.includes(order.status as GroupOrderStatus)) throw new Refused("invalid_transition");
    await tx
      .update(schema.groupOrders)
      .set({ status: transition.to, updatedAt: now, ...(action === "cancel" ? { cancelledAt: now } : {}) })
      .where(eq(schema.groupOrders.id, id));
    return id;
  });
}

/** Replaces her lines: items of the list and of the order's shop only, in the order's currency. */
export function replaceOwnLines(db: Database, userId: string, id: string, input: GroupOrderOwnLines, now: Date) {
  return writeThenView(db, async (tx) => {
    const order = await lockOwn(tx, userId, id, true);
    const eligible = new Map(
      (await listItems(tx, order.wishlistId)).filter((i) => i.shopId === order.shopId).map((i) => [i.itemId, i]),
    );
    const values = input.lines.map((line, index) => {
      const item = eligible.get(line.itemId);
      if (!item) throw new Refused("invalid_request");
      if (item.currency !== null && item.currency !== order.currency) throw new Refused("currency_mismatch");
      // The product and the name at write time: the line survives the item's deletion.
      return {
        groupOrderId: id,
        itemId: item.itemId,
        productId: item.productId,
        manualName: item.name,
        sizeLabel: line.sizeLabel,
        quantity: line.quantity,
        // One millisecond apart: her lines read back in the order she gave them.
        createdAt: new Date(now.getTime() + index),
        updatedAt: now,
      };
    });
    await tx
      .delete(schema.groupOrderLines)
      .where(and(eq(schema.groupOrderLines.groupOrderId, id), isNull(schema.groupOrderLines.buyerNameKey)));
    if (values.length > 0) await tx.insert(schema.groupOrderLines).values(values);
    await tx.update(schema.groupOrders).set({ updatedAt: now }).where(eq(schema.groupOrders.id, id));
    return id;
  });
}

/** « Retirer » (removedAt set) or its undo (cleared). */
export function setLineRemoved(db: Database, userId: string, id: string, lineId: string, removed: boolean, now: Date) {
  return writeThenView(db, async (tx) => {
    await lockOwn(tx, userId, id, true);
    if (!removed) {
      // Back among her friend's active lines: never more than GROUP_ORDER_MAX_LINES (the order row is locked).
      const [target] = await tx
        .select({ key: schema.groupOrderLines.buyerNameKey, removedAt: schema.groupOrderLines.removedAt })
        .from(schema.groupOrderLines)
        .where(and(eq(schema.groupOrderLines.id, lineId), eq(schema.groupOrderLines.groupOrderId, id)));
      if (!target) throw new Refused("not_found");
      if (target.key !== null && target.removedAt !== null) {
        const [active] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.groupOrderLines)
          .where(
            and(
              eq(schema.groupOrderLines.groupOrderId, id),
              eq(schema.groupOrderLines.buyerNameKey, target.key),
              isNull(schema.groupOrderLines.removedAt),
            ),
          );
        if ((active?.count ?? 0) >= GROUP_ORDER_MAX_LINES) throw new Refused("too_many_lines");
      }
    }
    const [line] = await tx
      .update(schema.groupOrderLines)
      .set({ removedAt: removed ? now : null, updatedAt: now })
      .where(and(eq(schema.groupOrderLines.id, lineId), eq(schema.groupOrderLines.groupOrderId, id)))
      .returning({ id: schema.groupOrderLines.id });
    if (!line) throw new Refused("not_found");
    return id;
  });
}

/**
 * « J'ai commandé »: freezes each active line's price (given, else its current one; none → `missing_price`) and the
 * shipping, writes what each friend owes, then moves her items to « Commandé » (no undo).
 */
export async function orderGroupOrder(
  db: Database,
  userId: string,
  id: string,
  input: GroupOrderOrder,
  now: Date,
): Promise<Outcome<OwnerGroupOrder>> {
  const outcome = await attempt(db, async (tx) => {
    const order = await lockOwn(tx, userId, id, false);
    if (!RUNNING.includes(order.status as GroupOrderStatus)) throw new Refused("invalid_transition");
    const lines = await readLines(tx, order);
    const given = new Map(input.lines.map((l) => [l.id, l.priceCents]));
    if (input.lines.some((l) => !lines.some((line) => line.row.id === l.id))) throw new Refused("invalid_request");
    const active = lines.filter((l) => l.row.removedAt === null);
    for (const line of active) {
      const price = given.get(line.row.id) ?? line.view.unitPriceCents;
      if (price === null) throw new Refused("missing_price");
      line.view.unitPriceCents = price;
      await tx
        .update(schema.groupOrderLines)
        .set({ finalPriceCents: price, updatedAt: now })
        .where(eq(schema.groupOrderLines.id, line.row.id));
    }
    await tx
      .update(schema.groupOrders)
      .set({ status: "ordered", orderedAt: now, shippingCents: input.shippingCents, updatedAt: now })
      .where(eq(schema.groupOrders.id, id));
    const people = peopleOf(lines);
    const totals = totalsOf(people, input.shippingCents, order.freeFromCents);
    const owed = people.flatMap((p) => {
      const share = totals.perPerson[p.key];
      return !p.isOwner && share
        ? [{ groupOrderId: id, buyerNameKey: p.key, buyerName: p.name, amountCents: share.totalCents }]
        : [];
    });
    if (owed.length > 0) await tx.insert(schema.groupOrderPayments).values(owed);
    // Her items (not in the trash) go to « Commandé » through the usual path, in this same transaction: the order
    // and the move commit or fail together. Its undo is not given.
    const itemIds = [
      ...new Set(active.flatMap((l) => (l.row.buyerNameKey === null && l.row.itemId ? [l.row.itemId] : []))),
    ];
    const alive =
      itemIds.length === 0
        ? []
        : await tx
            .select({ id: schema.items.id })
            .from(schema.items)
            .where(
              and(inArray(schema.items.id, itemIds), eq(schema.items.userId, userId), isNull(schema.items.deletedAt)),
            );
    if (alive.length === 0) return [];
    try {
      const moved = await runBulkIn(
        tx,
        userId,
        { op: "stage", ids: alive.map((i) => i.id), stage: "ordered", at: now.toISOString() },
        now,
      );
      return moved.trace.stageChanges;
    } catch (error) {
      const code = bulkRefusal(error);
      if (code) throw new Refused(code);
      throw error;
    }
  });
  if ("error" in outcome) return outcome;
  // Audience events, as the bulk route writes them.
  await trackItemEvents(
    db,
    userId,
    outcome.map((change) => ({ name: "item_stage_changed" as const, props: { from: change.from, to: change.to } })),
    now,
  );
  return viewById(db, id);
}

/** « Payé » ticked or unticked for one friend of an ordered group order. */
export function setPaid(db: Database, userId: string, id: string, nameKey: string, paid: boolean, now: Date) {
  return writeThenView(db, async (tx) => {
    const order = await lockOwn(tx, userId, id, false);
    if (order.status !== "ordered") throw new Refused("invalid_transition");
    const [row] = await tx
      .update(schema.groupOrderPayments)
      .set({ paidAt: paid ? now : null })
      .where(and(eq(schema.groupOrderPayments.groupOrderId, id), eq(schema.groupOrderPayments.buyerNameKey, nameKey)))
      .returning({ key: schema.groupOrderPayments.buyerNameKey });
    if (!row) throw new Refused("not_found");
    return id;
  });
}

/** Read access for the routes: her group order, or null. */
export async function ownGroupOrderView(db: Database, userId: string, id: string) {
  const order = await ownOrder(db, userId, id);
  return order ? toOwnerView(db, order) : null;
}

// ——— Her friends, on the shared link ———

/** The shared list a friend writes through (found by its token). */
export type FriendTarget = { wishlistId: string; shareTokenHash: string };
type NotInShop = { error: "not_in_shop"; shopName: string };

/** Past its deadline (end of that day in Paris), or no longer open: friends can no longer change anything. */
const isLockedForFriends = (order: OrderRow, now: Date) =>
  order.status !== "open" || (order.deadline !== null && parisDay(now) > order.deadline);

/**
 * The group order friends see on the list: the running one, else the latest ordered or cancelled — a cancelled one
 * for 30 days only. `lock`: `FOR UPDATE` on the order row.
 */
async function sharedOrder(db: Database | Tx, wishlistId: string, now: Date, lock = false) {
  const since = new Date(now.getTime() - RECENT_MS);
  const query = db
    .select()
    .from(schema.groupOrders)
    .where(
      and(
        eq(schema.groupOrders.wishlistId, wishlistId),
        or(inArray(schema.groupOrders.status, [...RUNNING, "ordered"]), gte(schema.groupOrders.cancelledAt, since)),
      ),
    )
    .orderBy(
      sql`case when ${schema.groupOrders.status} in ('open', 'closed') then 0 else 1 end`,
      desc(sql`coalesce(${schema.groupOrders.orderedAt}, ${schema.groupOrders.cancelledAt})`),
      desc(schema.groupOrders.createdAt),
    )
    .limit(1);
  // An ordered one stays (friends may still owe her); a cancelled one goes after 30 days.
  const [row] = lock ? await query.for("update") : await query;
  return row;
}

/** The shared list, still shared: stopping the share waits for us (or we find it gone). */
async function lockSharedList(tx: Tx, target: FriendTarget) {
  const [list] = await tx
    .select({ id: schema.wishlists.id })
    .from(schema.wishlists)
    .where(and(eq(schema.wishlists.id, target.wishlistId), eq(schema.wishlists.shareTokenHash, target.shareTokenHash)))
    .for("share");
  if (!list) throw new Refused("not_found");
}

async function shopNameOf(db: Database | Tx, shopId: string): Promise<string> {
  const [shop] = await db.select({ name: schema.shops.name }).from(schema.shops).where(eq(schema.shops.id, shopId));
  return shop?.name ?? "";
}

/**
 * A link a friend pastes must be of the order's shop (found by its domain, never created): its canonical address
 * and shop, or `not_in_shop`.
 */
async function linkOfShop(
  db: Database,
  order: OrderRow,
  url: string,
): Promise<{ url: string; shop: Shop } | NotInShop> {
  const canonical = canonicalizeUrl(url);
  const shop = canonical ? await findShopByHost(db, new URL(canonical).hostname) : null;
  const root = (await rootShops(db, [order.shopId])).get(order.shopId) ?? order.shopId;
  if (!canonical || !shop || shop.id !== root)
    return { error: "not_in_shop", shopName: await shopNameOf(db, order.shopId) };
  return { url: canonical, shop };
}

/**
 * « Je le prends aussi » / « Ajouter un autre article »: a friend's line, from an item of the list (of the order's
 * shop), a link of the same shop (its product page is created and a capture asked, by nobody), or her own name and
 * price. Locks, in this order: the shared list, the order row, then the name (one person per name, as for opinions
 * and gifts) — never an item before the order. Refusals that write nothing come before the name check, which may
 * attach the device.
 */
export async function addFriendLine(
  db: Database,
  queue: CaptureQueue,
  input: FriendLineInput & FriendTarget,
  now: () => Date,
): Promise<Outcome<{ lineId: string }> | NotInShop> {
  const nameKey = opinionNameKey(input.name);
  // A link is checked, and its page read, before the write: never for an order friends can no longer change.
  let link: { url: string; productId: string | null; orderId: string } | null = null;
  if (input.source !== "item" && input.url !== undefined) {
    const order = await sharedOrder(db, input.wishlistId, now());
    if (!order) return { error: "not_found" };
    if (isLockedForFriends(order, now())) return { error: "group_order_locked" };
    const found = await linkOfShop(db, order, input.url);
    if ("error" in found) return found;
    const productId =
      input.source === "url"
        ? (await requestProductCapture(db, queue, { url: found.url, shop: found.shop, requestedBy: null, now }))
            .productId
        : null;
    link = { url: found.url, productId, orderId: order.id };
  }
  return attempt(db, async (tx) => {
    const at = now();
    await lockSharedList(tx, input);
    const order = await sharedOrder(tx, input.wishlistId, at, true);
    if (!order) throw new Refused("not_found");
    // Another order since the link was checked (cancelled, then a new one): its shop may differ.
    if (isLockedForFriends(order, at) || (link && link.orderId !== order.id)) throw new Refused("group_order_locked");
    await lockFriendName(tx, input.wishlistId, nameKey);

    let source: Pick<
      typeof schema.groupOrderLines.$inferInsert,
      "itemId" | "productId" | "url" | "manualName" | "manualPriceCents"
    >;
    if (input.source === "item") {
      const item = (await listItems(tx, input.wishlistId)).find(
        (i) => i.itemId === input.itemId && i.shopId === order.shopId,
      );
      if (!item) throw new Refused("not_eligible");
      if (item.currency !== null && item.currency !== order.currency) throw new Refused("currency_mismatch");
      // The product and the name at write time: the line survives the item's deletion.
      source = { itemId: item.itemId, productId: item.productId, manualName: item.name };
    } else if (input.source === "url") {
      const productId = link?.productId ?? null;
      if (!productId) throw new Error("link line without its product");
      const [product] = await tx
        .select({ currency: schema.products.currency })
        .from(schema.products)
        .where(eq(schema.products.id, productId));
      if (product?.currency != null && product.currency !== order.currency) throw new Refused("currency_mismatch");
      source = { productId, url: link?.url ?? null };
    } else {
      source = { manualName: input.manualName, manualPriceCents: input.manualPriceCents, url: link?.url ?? null };
    }

    // The name first: another device learns nothing of her lines (a refusal rolls back the attachment).
    if ((await ensureFriendDevice(tx, input.wishlistId, nameKey, hashDeviceKey(input.deviceKey), input.claim)) !== "ok")
      throw new Refused("name_taken");
    const [active] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.groupOrderLines)
      .where(
        and(
          eq(schema.groupOrderLines.groupOrderId, order.id),
          eq(schema.groupOrderLines.buyerNameKey, nameKey),
          isNull(schema.groupOrderLines.removedAt),
        ),
      );
    if ((active?.count ?? 0) >= GROUP_ORDER_MAX_LINES) throw new Refused("too_many_lines");
    const [line] = await tx
      .insert(schema.groupOrderLines)
      .values({
        groupOrderId: order.id,
        buyerName: input.name,
        buyerNameKey: nameKey,
        ...source,
        sizeLabel: input.sizeLabel,
        quantity: input.quantity,
        createdAt: at,
        updatedAt: at,
      })
      .returning({ id: schema.groupOrderLines.id });
    if (!line) throw new Error("group order line not inserted");
    await tx.update(schema.groupOrders).set({ updatedAt: at }).where(eq(schema.groupOrders.id, order.id));
    return { lineId: line.id };
  });
}

/**
 * One of her lines, for a change: the shared list, then its order row (locked), then the name; the device must be
 * attached to the line's name (`forbidden` otherwise, the owner's lines included).
 */
async function lockFriendLine(
  tx: Tx,
  target: FriendTarget & { lineId: string; name: string; deviceKey: string },
  now: Date,
) {
  await lockSharedList(tx, target);
  const [found] = await tx
    .select({ order: schema.groupOrders })
    .from(schema.groupOrders)
    .innerJoin(schema.groupOrderLines, eq(schema.groupOrderLines.groupOrderId, schema.groupOrders.id))
    .where(and(eq(schema.groupOrderLines.id, target.lineId), eq(schema.groupOrders.wishlistId, target.wishlistId)))
    .for("update", { of: schema.groupOrders });
  if (!found) throw new Refused("not_found");
  if (isLockedForFriends(found.order, now)) throw new Refused("group_order_locked");
  const nameKey = opinionNameKey(target.name);
  await lockFriendName(tx, target.wishlistId, nameKey);
  const [line] = await tx.select().from(schema.groupOrderLines).where(eq(schema.groupOrderLines.id, target.lineId));
  if (!line) throw new Refused("not_found");
  if (line.buyerNameKey !== nameKey || !(await isFriendDevice(tx, target.wishlistId, nameKey, target.deviceKey)))
    throw new Refused("forbidden");
  return { order: found.order, line };
}

/**
 * Her own name and price are for a line she typed, or a link whose page gave no price (reading failed or found
 * none): never over an item of the list or a price the shop gives.
 */
async function mayNameItself(tx: Tx, line: typeof schema.groupOrderLines.$inferSelect): Promise<boolean> {
  if (line.itemId !== null) return false;
  if (line.productId === null) return true;
  const [product] = await tx
    .select({ priceCents: schema.products.priceCents, captureStatus: schema.products.captureStatus })
    .from(schema.products)
    .where(eq(schema.products.id, line.productId));
  return product !== undefined && (product.priceCents === null || product.captureStatus === "failed");
}

/**
 * « Modifier »: size and quantity; name and price only on her own entry or a link read without a price (never over
 * a price the shop gives). A line the owner took out is not changed (`not_found`).
 */
export async function patchFriendLine(
  db: Database,
  input: FriendLinePatch & FriendTarget & { lineId: string },
  now: Date,
): Promise<Outcome<{ lineId: string }>> {
  return attempt(db, async (tx) => {
    const { order, line } = await lockFriendLine(tx, input, now);
    if (line.removedAt !== null) throw new Refused("not_found");
    const manual = input.manualName !== undefined || input.manualPriceCents !== undefined;
    if (manual && !(await mayNameItself(tx, line))) throw new Refused("invalid_request");
    await tx
      .update(schema.groupOrderLines)
      .set({
        sizeLabel: input.sizeLabel,
        quantity: input.quantity,
        ...(input.manualName === undefined ? {} : { manualName: input.manualName }),
        ...(input.manualPriceCents === undefined ? {} : { manualPriceCents: input.manualPriceCents }),
        updatedAt: now,
      })
      .where(eq(schema.groupOrderLines.id, line.id));
    await tx.update(schema.groupOrders).set({ updatedAt: now }).where(eq(schema.groupOrders.id, order.id));
    return { lineId: line.id };
  });
}

/** « Retirer »: her line is gone for everyone (a line the owner took out included). */
export async function deleteFriendLine(
  db: Database,
  input: FriendLineDelete & FriendTarget & { lineId: string },
  now: Date,
): Promise<Outcome<{ lineId: string }>> {
  return attempt(db, async (tx) => {
    const { order, line } = await lockFriendLine(tx, input, now);
    await tx.delete(schema.groupOrderLines).where(eq(schema.groupOrderLines.id, line.id));
    await tx.update(schema.groupOrders).set({ updatedAt: now }).where(eq(schema.groupOrders.id, order.id));
    return { lineId: line.id };
  });
}

/**
 * The group order on the shared link: everyone's active lines and the totals; `mine` (her share, what she owes, the
 * lines the owner took out) only for a device attached to a name with a line in it. Null: none, or cancelled more
 * than 30 days ago.
 */
export async function sharedGroupOrderView(
  db: Database,
  list: { id: string; showOwnerName: boolean },
  deviceKey: string | null,
  now: Date,
): Promise<SharedGroupOrder | null> {
  const order = await sharedOrder(db, list.id, now);
  if (!order) return null;
  const [shopName, lines, items, ownerName, deviceNames] = await Promise.all([
    shopNameOf(db, order.shopId),
    readLines(db, order),
    listItems(db, order.wishlistId),
    list.showOwnerName ? ownerFirstName(db, order.wishlistId) : Promise.resolve(""),
    deviceKey ? friendNameKeysOf(db, list.id, deviceKey) : Promise.resolve([]),
  ]);
  const people = peopleOf(lines);
  const totals = totalsOf(people, order.shippingCents, order.freeFromCents);
  const own = people.find((p) => !p.isOwner && deviceNames.includes(p.key));
  let mine: SharedGroupOrder["mine"] = null;
  if (own) {
    const [payment] = await db
      .select({ paidAt: schema.groupOrderPayments.paidAt })
      .from(schema.groupOrderPayments)
      .where(
        and(eq(schema.groupOrderPayments.groupOrderId, order.id), eq(schema.groupOrderPayments.buyerNameKey, own.key)),
      );
    const share = totals.perPerson[own.key] ?? { itemsCents: 0, shippingCents: 0, totalCents: 0 };
    mine = {
      name: own.name,
      lineIds: own.lines.filter((l) => l.row.removedAt === null).map((l) => l.row.id),
      ...share,
      provisional: order.status !== "ordered",
      paidAt: payment?.paidAt?.toISOString() ?? null,
      removedLines: own.lines.filter((l) => l.row.removedAt !== null).map((l) => ({ id: l.row.id, name: l.view.name })),
    };
  }
  return {
    id: order.id,
    shopName,
    ownerName: ownerName || null,
    status: order.status as GroupOrderStatus,
    deadline: order.deadline,
    locked: isLockedForFriends(order, now),
    shipping: { label: order.shippingLabel, shippingCents: order.shippingCents, freeFromCents: order.freeFromCents },
    currency: order.currency,
    totals: {
      totalCents: totals.totalCents,
      remainingForFreeCents: totals.remainingForFreeCents,
      shippingTotalCents: totals.shippingTotalCents,
    },
    // Lines the owner took out show to their friend only (`mine.removedLines`).
    people: people.flatMap((p) => {
      const active = p.lines.filter((l) => l.row.removedAt === null);
      if (active.length === 0) return [];
      return [
        {
          name: p.isOwner ? ownerName : p.name,
          isOwner: p.isOwner,
          lines: active.map(({ view }) => ({
            id: view.id,
            name: view.name,
            imageUrl: view.imageUrl,
            sizeLabel: view.sizeLabel,
            quantity: view.quantity,
            unitPriceCents: view.unitPriceCents,
            status: view.status,
          })),
        },
      ];
    }),
    eligibleItemIds: items.filter((i) => i.shopId === order.shopId).map((i) => i.itemId),
    mine,
    orderedAt: order.orderedAt?.toISOString() ?? null,
  };
}
