import {
  and,
  asc,
  type Database,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  receivedQuestionOpen,
  receiveOrderItems,
  schema,
  sql,
} from "@closyria/db";
import {
  type Carrier,
  detectCarrier,
  MAX_ORDER_LINE_NAME,
  type ManualOrderInput,
  nameFromUrl,
  nextParcelCheckClamped,
  type OrderLineInput,
  type OrderPatch,
  type OrderReceivedAnswer,
  type OrderView,
  type ParcelCarrierInput,
  parcelCheckUntil,
  type TrackingInput,
  type WardrobeErrorCode,
} from "@closyria/shared";
import { alertsFollowOrders } from "../wardrobe/alert-events";
import type { Tx } from "../wardrobe/events";
import { recordEvent } from "../wardrobe/events";
import { type Item, insertOrderedItem, lockActiveItemFor, lockOwnItem, lockProductOfUser } from "../wardrobe/items";
import { findOwnProfile, lockProfilesOf } from "../wardrobe/profiles";
import { foldShopName, foldShopNameSql, normalizeArticleName, pickSameArticle } from "./match";
import { loadOrderView } from "./view";

/**
 * « Après la commande », Task 4: what she does with an order (docs/specs/2026-11-14-apres-commande.md §3.2–3.3).
 *
 * Lock order, always: her profiles (`lockProfilesOf`, as a profile deletion, which moves orders: it also serialises
 * her « C'est bon », manual entries and pasted numbers), the per-number advisory lock of a tracking number (as the
 * e-mail reading, Task 3), the replaced e-mail, the order row (`for update`, as the e-mail reading's completion), then
 * the item rows — except the pasted number, which reads its item before its orders: the profiles lock keeps it from
 * meeting a « C'est bon », the only other action that locks an order and then an item.
 */

type Order = typeof schema.orders.$inferSelect;
type OrderLine = typeof schema.orderLines.$inferSelect;
export type OrderOutcome = { order: OrderView; created: boolean } | { error: WardrobeErrorCode };

/** Thrown inside a transaction to roll it back with a stable error. */
class OrderError extends Error {
  constructor(readonly code: WardrobeErrorCode) {
    super(code);
  }
}

async function inTransaction(db: Database, work: (tx: Tx) => Promise<OrderOutcome>): Promise<OrderOutcome> {
  try {
    return await db.transaction(work);
  } catch (error) {
    if (error instanceof OrderError) return { error: error.code };
    throw error;
  }
}

async function viewOf(tx: Tx, userId: string, orderId: string, created = false): Promise<OrderOutcome> {
  const order = await loadOrderView(tx, userId, orderId);
  if (!order) throw new Error("order vanished in its own transaction");
  return { order, created };
}

async function lockOwnOrder(tx: Tx, userId: string, orderId: string): Promise<Order | null> {
  const [row] = await tx
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.userId, userId)))
    .for("update");
  return row ?? null;
}

/** Same lock key as the e-mail reading (Task 3): two parcels of one number are never filed at once. */
async function lockTrackingNumber(tx: Tx, userId: string, trackingNumber: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`parcel:${userId}:${trackingNumber}`}, 0))`);
}

// --- Shop by typed name -------------------------------------------------------------------------------------------

/**
 * The shop she named: the one with exactly that name, case and accents aside (never a merged one; a published one
 * first); otherwise no shop and her name kept on the order (`shop_name`). A typed name never creates a shop.
 */
export async function resolveShopName(
  db: Database | Tx,
  name: string,
): Promise<{ shopId: string | null; shopName: string | null }> {
  const typed = name.trim().replace(/\s+/g, " ");
  const [shop] = await db
    .select({ id: schema.shops.id })
    .from(schema.shops)
    .where(and(isNull(schema.shops.mergedIntoId), sql`${foldShopNameSql(schema.shops.name)} = ${foldShopName(typed)}`))
    .orderBy(sql`(${schema.shops.status} = 'published') desc`, asc(schema.shops.createdAt), asc(schema.shops.id))
    .limit(1);
  return shop ? { shopId: shop.id, shopName: null } : { shopId: null, shopName: typed };
}

// --- Lines --------------------------------------------------------------------------------------------------------

/**
 * Writes the lines; `previous` are the lines they replace (« Corriger »): a line keeping the name of one of them keeps
 * its product (the link read from the e-mail), the form not carrying it.
 */
async function insertLines(tx: Tx, orderId: string, lines: OrderLineInput[], previous: OrderLine[] = []) {
  const productOf = new Map<string, string | null>();
  for (const line of previous) {
    if (!line.productId) continue;
    const key = normalizeArticleName(line.name);
    productOf.set(key, productOf.has(key) && productOf.get(key) !== line.productId ? null : line.productId);
  }
  await tx.insert(schema.orderLines).values(
    lines.map((line, position) => ({
      orderId,
      productId: productOf.get(normalizeArticleName(line.name)) ?? null,
      name: line.name,
      sizeLabel: line.sizeLabel ?? null,
      color: line.color ?? null,
      quantity: line.quantity,
      priceCents: line.priceCents ?? null,
      currency: line.priceCents == null ? null : (line.currency ?? null),
      position,
    })),
  );
}

/** What she paid for a line (unit price × quantity), counted in her euro budgets: null in another currency. */
function paidCents(line: OrderLine): number | null {
  return line.priceCents !== null && line.currency === "EUR" ? line.priceCents * line.quantity : null;
}

// --- « C'est bon » ------------------------------------------------------------------------------------------------

/** Her items still « Repéré » or already « Commandé » that an order line may be (RF 3). */
const LINKABLE_STAGES = ["spotted", "ordered"];

/**
 * Her article of the same shop and name as the line, when exactly one: of the order's profile (a name alone never
 * reaches another profile; a product does, `lockActiveItemFor`), still a wish or already ordered, not in the trash,
 * not taken by another line of this order nor by another validated order. Conservative (`pickSameArticle`): a doubt
 * makes a new article rather than a wrong link.
 */
async function sameArticleOfShop(
  tx: Tx,
  userId: string,
  order: Order,
  line: OrderLine,
  taken: Set<string>,
): Promise<string | null> {
  if (!order.shopId) return null;
  const otherOrders = tx
    .select({ one: sql`1` })
    .from(schema.orderLines)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
    .where(
      and(
        eq(schema.orderLines.itemId, schema.items.id),
        eq(schema.orders.status, "confirmed"),
        ne(schema.orders.id, order.id),
      ),
    );
  const candidates = await tx
    .select({
      id: schema.items.id,
      name: sql<string | null>`coalesce(${schema.items.nameOverride}, ${schema.products.name})`,
    })
    .from(schema.items)
    .innerJoin(schema.products, eq(schema.products.id, schema.items.productId))
    .where(
      and(
        eq(schema.items.userId, userId),
        eq(schema.items.profileId, order.profileId),
        isNull(schema.items.deletedAt),
        inArray(schema.items.stage, LINKABLE_STAGES),
        eq(schema.products.shopId, order.shopId),
        sql`not exists (${otherOrders})`,
      ),
    );
  return pickSameArticle(
    line.name,
    candidates.filter((c) => !taken.has(c.id)),
  );
}

/**
 * The line's size goes onto her article (RF 3); a wish goes to « Commandé » on the order's date, with its history
 * row and what she paid; an article already ordered only gets what it lacked.
 */
async function applyLine(tx: Tx, item: Item, line: OrderLine, at: Date, now: Date) {
  const paid = paidCents(line);
  if (item.stage === "spotted") {
    await tx
      .update(schema.items)
      .set({
        stage: "ordered",
        inOrderDraft: false,
        sizeLabel: line.sizeLabel ?? item.sizeLabel,
        pricePaidCents: paid ?? item.pricePaidCents,
        updatedAt: now,
      })
      .where(eq(schema.items.id, item.id));
    await recordEvent(tx, item, { type: "stage", stage: "ordered", at, amountCents: paid });
    return;
  }
  await tx
    .update(schema.items)
    .set({
      sizeLabel: line.sizeLabel ?? item.sizeLabel,
      pricePaidCents: item.pricePaidCents ?? paid,
      updatedAt: now,
    })
    .where(eq(schema.items.id, item.id));
}

/** Her article for the line: linked when it is one she keeps, else created « Commandé » (without a product if need be). */
async function articleFor(
  tx: Tx,
  userId: string,
  order: Order,
  line: OrderLine,
  taken: Set<string>,
  now: Date,
): Promise<string> {
  const at = order.orderedAt ?? now;
  const create = (productId: string | null) =>
    insertOrderedItem(
      tx,
      {
        userId,
        profileId: order.profileId,
        productId,
        name: line.name,
        sizeLabel: line.sizeLabel,
        pricePaidCents: paidCents(line),
        at,
      },
      now,
    );
  if (line.productId) {
    // One active item per product (G2): hers is linked whatever its stage; a stage past « Commandé » is kept.
    await lockProductOfUser(tx, userId, line.productId);
    const existing = await lockActiveItemFor(tx, userId, line.productId);
    if (!existing) return create(line.productId);
    if (LINKABLE_STAGES.includes(existing.stage)) await applyLine(tx, existing, line, at, now);
    return existing.id;
  }
  const sameId = await sameArticleOfShop(tx, userId, order, line, taken);
  if (sameId) {
    const item = await lockOwnItem(tx, userId, sameId);
    // Read again under its lock: trashed or moved past « Commandé » meanwhile, it is no longer this line's.
    if (item && !item.deletedAt && LINKABLE_STAGES.includes(item.stage)) {
      await applyLine(tx, item, line, at, now);
      return item.id;
    }
  }
  return create(null);
}

/** « C'est bon » on a draft already locked: every line gets its article, then the order is validated. */
async function confirmLocked(tx: Tx, userId: string, order: Order, now: Date) {
  const lines = await tx
    .select()
    .from(schema.orderLines)
    .where(eq(schema.orderLines.orderId, order.id))
    .orderBy(asc(schema.orderLines.position), asc(schema.orderLines.id));
  const taken = new Set(lines.flatMap((l) => (l.itemId ? [l.itemId] : [])));
  for (const line of lines) {
    if (line.itemId) continue;
    const itemId = await articleFor(tx, userId, order, line, taken, now);
    taken.add(itemId);
    await tx.update(schema.orderLines).set({ itemId }).where(eq(schema.orderLines.id, line.id));
  }
  await tx
    .update(schema.orders)
    .set({ status: "confirmed", confirmedAt: now, updatedAt: now })
    .where(eq(schema.orders.id, order.id));
}

/**
 * « C'est bon » (spec §3.2, RF 3). Idempotent: a validated order is answered as it is, nothing created twice (the
 * order row is locked, a second « C'est bon » waits for the first and finds it validated).
 */
export async function confirmOrder(db: Database, userId: string, orderId: string, now: Date): Promise<OrderOutcome> {
  return inTransaction(db, async (tx) => {
    await lockProfilesOf(tx, userId);
    const order = await lockOwnOrder(tx, userId, orderId);
    if (!order) return { error: "not_found" };
    if (order.status === "dismissed") return { error: "order_dismissed" };
    if (order.status === "draft") await confirmLocked(tx, userId, order, now);
    return viewOf(tx, userId, order.id);
  });
}

// --- « Corriger » and « Ce n'est pas une commande » ---------------------------------------------------------------

/** « Corriger » a draft: only the fields given change; `lines` replaces them all. */
export async function patchOrder(
  db: Database,
  userId: string,
  orderId: string,
  patch: OrderPatch,
  now: Date,
): Promise<OrderOutcome> {
  const shop = patch.shopName === undefined ? undefined : await resolveShopName(db, patch.shopName);
  return inTransaction(db, async (tx) => {
    await lockProfilesOf(tx, userId);
    const order = await lockOwnOrder(tx, userId, orderId);
    if (!order) return { error: "not_found" };
    if (order.status !== "draft") return { error: "order_not_draft" };
    if (patch.profileId && !(await findOwnProfile(tx, userId, patch.profileId))) return { error: "not_found" };
    await tx
      .update(schema.orders)
      .set({
        ...(patch.profileId ? { profileId: patch.profileId } : {}),
        ...(shop ? shop : {}),
        ...(patch.externalRef !== undefined ? { externalRef: patch.externalRef } : {}),
        ...(patch.orderedAt !== undefined ? { orderedAt: patch.orderedAt ? new Date(patch.orderedAt) : null } : {}),
        updatedAt: now,
      })
      .where(eq(schema.orders.id, order.id));
    // Its alerts (« Commande reçue de … ») go to its new profile.
    if (patch.profileId) await alertsFollowOrders(tx, sql`e.order_id = ${order.id}`);
    if (patch.lines) {
      const previous = await tx.delete(schema.orderLines).where(eq(schema.orderLines.orderId, order.id)).returning();
      await insertLines(tx, order.id, patch.lines, previous);
    }
    return viewOf(tx, userId, order.id);
  });
}

/** « Ce n'est pas une commande »: a draft is set aside (twice is harmless); a validated order stays. */
export async function dismissOrder(db: Database, userId: string, orderId: string, now: Date): Promise<OrderOutcome> {
  return inTransaction(db, async (tx) => {
    const order = await lockOwnOrder(tx, userId, orderId);
    if (!order) return { error: "not_found" };
    if (order.status === "confirmed") return { error: "order_not_draft" };
    if (order.status === "draft") {
      await tx.update(schema.orders).set({ status: "dismissed", updatedAt: now }).where(eq(schema.orders.id, order.id));
    }
    return viewOf(tx, userId, order.id);
  });
}

// --- Parcels ------------------------------------------------------------------------------------------------------

/**
 * A parcel she gave: the carrier read from the number's own signature, else the one she picked, else unknown
 * (`unknown`, still created: « Suivre chez le transporteur » and the question at J+10 take over, Tasks 5–6). Its
 * first check is set so that the tracking (Task 5) picks it up.
 */
async function addParcel(tx: Tx, orderId: string, trackingNumber: string, picked: Carrier | undefined, now: Date) {
  const carrier = detectCarrier(trackingNumber, picked ?? null) ?? picked ?? null;
  const status = carrier ? "pending" : "unknown";
  const checkUntil = parcelCheckUntil(now);
  await tx
    .insert(schema.parcels)
    .values({
      orderId,
      carrier,
      trackingNumber,
      status,
      nextCheckAt: nextParcelCheckClamped(status, now, checkUntil),
      checkUntil,
    })
    .onConflictDoNothing({ target: [schema.parcels.orderId, schema.parcels.trackingNumber] });
}

/** Her open order (to validate or validated) already holding this number, locked; null when none. */
async function orderWithParcel(tx: Tx, userId: string, trackingNumber: string): Promise<Order | null> {
  const [row] = await tx
    .select({ order: schema.orders })
    .from(schema.parcels)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.parcels.orderId))
    .where(
      and(
        eq(schema.orders.userId, userId),
        eq(schema.parcels.trackingNumber, trackingNumber),
        inArray(schema.orders.status, ["draft", "confirmed"]),
      ),
    )
    .orderBy(asc(schema.orders.createdAt))
    .limit(1)
    .for("update", { of: schema.orders });
  return row?.order ?? null;
}

// --- Manual entry -------------------------------------------------------------------------------------------------

/**
 * Manual entry (« On n'a pas su lire cet e-mail », or typed from scratch): she typed it, so it is validated at once
 * (its lines get their articles as with « C'est bon »), with its parcel when she gave a number.
 */
export async function createManualOrder(
  db: Database,
  userId: string,
  input: ManualOrderInput,
  now: Date,
): Promise<OrderOutcome> {
  if (!(await findOwnProfile(db, userId, input.profileId))) return { error: "not_found" };
  if (input.inboundEmailId) {
    const [mail] = await db
      .select({ id: schema.inboundEmails.id })
      .from(schema.inboundEmails)
      .where(
        and(
          eq(schema.inboundEmails.id, input.inboundEmailId),
          eq(schema.inboundEmails.userId, userId),
          // Only « On n'a pas su lire cet e-mail »: one still being read would get a typed order, then a read one.
          eq(schema.inboundEmails.status, "failed"),
        ),
      );
    if (!mail) return { error: "not_found" };
  }
  const shop = await resolveShopName(db, input.shopName);
  return inTransaction(db, async (tx) => {
    await lockProfilesOf(tx, userId);
    if (input.trackingNumber) {
      await lockTrackingNumber(tx, userId, input.trackingNumber);
      if (await orderWithParcel(tx, userId, input.trackingNumber)) return { error: "tracking_exists" };
    }
    if (input.inboundEmailId) {
      // The e-mail is replaced once: an order of it (typed, or read from it) already there answers 409.
      await tx
        .select({ id: schema.inboundEmails.id })
        .from(schema.inboundEmails)
        .where(eq(schema.inboundEmails.id, input.inboundEmailId))
        .for("update");
      const [replaced] = await tx
        .select({ id: schema.orders.id })
        .from(schema.orders)
        .where(and(eq(schema.orders.inboundEmailId, input.inboundEmailId), ne(schema.orders.status, "dismissed")))
        .limit(1);
      if (replaced) return { error: "order_exists" };
    }
    // Read again under the lock: a profile deleted meanwhile answers 404.
    if (!(await findOwnProfile(tx, userId, input.profileId))) return { error: "not_found" };
    const [order] = await tx
      .insert(schema.orders)
      .values({
        userId,
        profileId: input.profileId,
        ...shop,
        externalRef: input.externalRef ?? null,
        orderedAt: input.orderedAt ? new Date(input.orderedAt) : null,
        status: "draft",
        source: "manual",
        parseMethod: "manual",
        inboundEmailId: input.inboundEmailId ?? null,
      })
      .returning();
    if (!order) throw new Error("order not inserted");
    await insertLines(tx, order.id, input.lines);
    await confirmLocked(tx, userId, order, now);
    if (input.trackingNumber) await addParcel(tx, order.id, input.trackingNumber, input.carrier, now);
    return viewOf(tx, userId, order.id, true);
  });
}

// --- « Ajouter un numéro de suivi » on an article -----------------------------------------------------------------

/**
 * A number pasted on her article « Commandé » (spec §3.3): the parcel joins the validated order the article belongs
 * to; an article without one gets its own order (`tracking`, validated, one line). The same number twice is
 * harmless; a number of another of her orders is refused (`tracking_exists`).
 */
export async function addItemTracking(
  db: Database,
  userId: string,
  itemId: string,
  input: TrackingInput,
  now: Date,
): Promise<OrderOutcome> {
  return inTransaction(db, async (tx) => {
    await lockProfilesOf(tx, userId);
    await lockTrackingNumber(tx, userId, input.trackingNumber);
    const item = await lockOwnItem(tx, userId, itemId);
    if (!item) return { error: "not_found" };
    if (item.deletedAt) return { error: "item_deleted" };
    if (item.stage !== "ordered") return { error: "item_not_ordered" };

    const [own] = await tx
      .select({ order: schema.orders })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.userId, userId),
          eq(schema.orders.status, "confirmed"),
          sql`exists (select 1 from ${schema.orderLines} where ${schema.orderLines.orderId} = ${schema.orders.id} and ${schema.orderLines.itemId} = ${item.id})`,
        ),
      )
      .orderBy(desc(schema.orders.createdAt), desc(schema.orders.id))
      .limit(1)
      .for("update");
    const holder = await orderWithParcel(tx, userId, input.trackingNumber);
    if (holder && holder.id !== own?.order.id) throw new OrderError("tracking_exists");
    if (own) {
      await addParcel(tx, own.order.id, input.trackingNumber, input.carrier, now);
      await tx.update(schema.orders).set({ updatedAt: now }).where(eq(schema.orders.id, own.order.id));
      return viewOf(tx, userId, own.order.id);
    }

    const [product] = item.productId
      ? await tx
          .select({ shopId: schema.products.shopId, name: schema.products.name, url: schema.products.canonicalUrl })
          .from(schema.products)
          .where(eq(schema.products.id, item.productId))
      : [];
    const [order] = await tx
      .insert(schema.orders)
      .values({
        userId,
        profileId: item.profileId,
        shopId: product?.shopId ?? null,
        status: "confirmed",
        confirmedAt: now,
        source: "tracking",
        parseMethod: "manual",
      })
      .returning();
    if (!order) throw new Error("order not inserted");
    await tx.insert(schema.orderLines).values({
      orderId: order.id,
      itemId: item.id,
      productId: item.productId,
      // Her name for it, else its product's, else the one its address gives (a product always has one).
      name: (
        item.nameOverride ??
        product?.name ??
        (product && nameFromUrl(product.url)) ??
        product?.url ??
        itemId
      ).slice(0, MAX_ORDER_LINE_NAME),
      sizeLabel: item.sizeLabel,
      quantity: 1,
      priceCents: item.pricePaidCents,
      currency: item.pricePaidCents === null ? null : "EUR",
    });
    await addParcel(tx, order.id, input.trackingNumber, input.carrier, now);
    return viewOf(tx, userId, order.id, true);
  });
}

// --- « Tu as reçu ta commande {boutique} ? » (Task 6) -------------------------------------------------------------

/**
 * Her answer to « Tu as reçu ta commande ? » on a validated order (spec §3.5).
 * - « Oui »: her articles of the order still « Commandé » go to « Reçu » now, with the return deadline counted from
 *   today (`receiveOrderItems`, the same move as a delivery); its parcels are no longer checked (`next_check_at`
 *   null, `check_until` now: settled). A parcel the carrier reports delivered later changes nothing more (a deadline
 *   already set is kept). Twice is harmless.
 * - « Pas encore »: recorded when a question is waiting for her (the question at 20 days follows it); otherwise
 *   nothing (the first question at 10 days stays the first).
 * Lock order: her profiles, the order, its parcels, then the items.
 */
export async function answerReceived(
  db: Database,
  userId: string,
  orderId: string,
  input: OrderReceivedAnswer,
  now: Date,
): Promise<OrderOutcome> {
  return inTransaction(db, async (tx) => {
    await lockProfilesOf(tx, userId);
    const order = await lockOwnOrder(tx, userId, orderId);
    if (!order) return { error: "not_found" };
    if (order.status === "dismissed") return { error: "order_dismissed" };
    if (order.status !== "confirmed") return { error: "order_not_confirmed" };
    if (input.answer === "yes") {
      await tx
        .select({ id: schema.parcels.id })
        .from(schema.parcels)
        .where(eq(schema.parcels.orderId, order.id))
        .orderBy(asc(schema.parcels.id))
        .for("update");
      await tx
        .update(schema.parcels)
        .set({
          nextCheckAt: null,
          checkUntil: sql`least(${schema.parcels.checkUntil}, ${now.toISOString()}::timestamptz)`,
        })
        .where(eq(schema.parcels.orderId, order.id));
      await receiveOrderItems(tx, order, now, now);
    } else {
      const [open] = await tx
        .select({ open: sql<boolean>`${receivedQuestionOpen()}` })
        .from(schema.orders)
        .where(eq(schema.orders.id, order.id));
      if (open?.open) {
        await tx.update(schema.orders).set({ receivedNotYetAt: now }).where(eq(schema.orders.id, order.id));
      }
    }
    await tx.update(schema.orders).set({ updatedAt: now }).where(eq(schema.orders.id, order.id));
    return viewOf(tx, userId, order.id);
  });
}

// --- Carrier correction (Task 7) ----------------------------------------------------------------------------------

/**
 * « Changer de transporteur » on one of her parcels: the carrier she picked, and the tracking starts again (step
 * `pending`, no failure counted, next check at the usual rhythm — §10.4: a parcel without a carrier stopped being
 * checked). A tracking already over (30 days passed) gets a new window from now. A delivered parcel stays as it is
 * (409 `parcel_delivered`); a parcel of a dismissed order, or of another account, is refused like its order.
 */
export async function changeParcelCarrier(
  db: Database,
  userId: string,
  orderId: string,
  parcelId: string,
  input: ParcelCarrierInput,
  now: Date,
): Promise<OrderOutcome> {
  return inTransaction(db, async (tx) => {
    await lockProfilesOf(tx, userId);
    const order = await lockOwnOrder(tx, userId, orderId);
    if (!order) return { error: "not_found" };
    if (order.status === "dismissed") return { error: "order_dismissed" };
    const [parcel] = await tx
      .select()
      .from(schema.parcels)
      .where(and(eq(schema.parcels.id, parcelId), eq(schema.parcels.orderId, order.id)))
      .for("update");
    if (!parcel) return { error: "not_found" };
    if (parcel.status === "delivered") return { error: "parcel_delivered" };
    const checkUntil = parcel.checkUntil.getTime() > now.getTime() ? parcel.checkUntil : parcelCheckUntil(now);
    await tx
      .update(schema.parcels)
      .set({
        carrier: input.carrier,
        status: "pending",
        checkFailures: 0,
        checkUntil,
        nextCheckAt: nextParcelCheckClamped("pending", now, checkUntil),
      })
      .where(eq(schema.parcels.id, parcel.id));
    await tx.update(schema.orders).set({ updatedAt: now }).where(eq(schema.orders.id, order.id));
    return viewOf(tx, userId, order.id);
  });
}

/**
 * « Ce n'est pas une commande » on an e-mail nothing could read: no longer listed (its raw message still goes after
 * its 30 days). Only hers, only a failed one with no order typed from it (404 otherwise). Twice is harmless.
 */
export async function dismissUnreadEmail(db: Database, userId: string, emailId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(schema.inboundEmails)
    .set({ dismissedAt: sql`coalesce(${schema.inboundEmails.dismissedAt}, ${now.toISOString()}::timestamptz)` })
    .where(
      and(
        eq(schema.inboundEmails.id, emailId),
        eq(schema.inboundEmails.userId, userId),
        eq(schema.inboundEmails.status, "failed"),
        sql`not exists (select 1 from ${schema.orders} o where o.inbound_email_id = ${schema.inboundEmails.id} and o.status <> 'dismissed')`,
      ),
    )
    .returning({ id: schema.inboundEmails.id });
  return rows.length > 0;
}
