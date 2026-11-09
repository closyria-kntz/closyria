import { and, asc, type Database, eq, inArray, isNull, schema, sql } from "@closyria/db";
import {
  type ItemBulk,
  type ItemStage,
  MAX_BULK_ITEMS,
  type OrderDraftInput,
  type UndoPayload,
  type WardrobeErrorCode,
} from "@closyria/shared";
import { pgCode } from "../pg-code";
import type { Tx } from "./events";
import { clearGiftsRemoved, clearOwnerTook, markGiftsRemoved, unreceiveGifts, untakeUndo } from "./gifts";
import { AMOUNT_COLUMN, type Item, lockProductOfUser } from "./items";
import { mergeItemInto } from "./merge-items";
import { spentCentsFor } from "./spent";
import { changedFields, groupIds, type ItemFieldValues, reselectUndo, setFieldsUndo } from "./undo";

/** Aborts the whole transaction with a stable error code (all or nothing). */
class BulkError extends Error {
  constructor(readonly code: WardrobeErrorCode) {
    super(code);
  }
}

/** What a batch did, for the audience events (spec §6). */
export type BulkTrace = { stageChanges: { from: ItemStage; to: ItemStage }[]; moves: number };

export type BulkOutcome =
  | { itemIds: string[]; undo: UndoPayload | null; trace: BulkTrace }
  | { error: WardrobeErrorCode };

/** `merged`: items of a restore merged into an active one, gone for the ops that follow in an undo. */
type OpResult = { changed: string[]; undoOps: ItemBulk[]; eventIds: string[]; trace: BulkTrace; merged?: string[] };
type OpOptions = {
  now: Date /** False while replaying an undo: no new history rows (ruling R4). */;
  writeEvents: boolean;
};

const uniqueSorted = (values: string[]) => [...new Set(values)].sort();
const emptyTrace = (): BulkTrace => ({ stageChanges: [], moves: 0 });

/**
 * Runs `work` in one transaction: a `BulkError` or a foreign-key violation (a profile, list or tag deleted in the
 * meantime) rolls everything back and becomes the outcome's error.
 */
async function inTransaction(db: Database, work: (tx: Tx) => Promise<BulkOutcome>): Promise<BulkOutcome> {
  try {
    return await db.transaction(work);
  } catch (error) {
    if (error instanceof BulkError) return { error: error.code };
    if (pgCode(error) === "23503") return { error: "not_found" };
    throw error;
  }
}

/** Share-locks her rows of a parent table (profile, list, tag): 404 for an id of another user, unknown or deleted. */
async function shareOwn(
  tx: Tx,
  table: typeof schema.profiles | typeof schema.wishlists | typeof schema.tags,
  userId: string,
  ids: string[],
) {
  if (ids.length === 0) return;
  const { rows } = await tx.execute(
    sql`select id from ${table} where user_id = ${userId} and ${inArray(table.id, ids)} order by id for share`,
  );
  if (rows.length !== ids.length) throw new BulkError("not_found");
}

/**
 * Takes every lock the ops need, before changing anything, always in this order (no deadlock with the single-item
 * routes, the profile deletion or another batch):
 * 1. the parent rows (target profiles, lists, tags), shared, by id — a profile being deleted waits or is gone (404);
 * 2. the per-product advisory locks of the items to restore, by product id — as the creation and the single restore;
 * 3. the item rows, by id: the ids given and, for a restore, her active items for the same products (merge targets).
 * An id of another user or unknown answers 404 for the whole request.
 */
async function lockFor(tx: Tx, userId: string, ops: ItemBulk[]): Promise<void> {
  const parents = (pick: (op: ItemBulk) => string | undefined) => uniqueSorted(ops.flatMap((op) => pick(op) ?? []));
  await shareOwn(
    tx,
    schema.profiles,
    userId,
    parents((op) => (op.op === "move" ? op.profileId : undefined)),
  );
  await shareOwn(
    tx,
    schema.wishlists,
    userId,
    parents((op) => (op.op === "addToList" || op.op === "removeFromList" ? op.wishlistId : undefined)),
  );
  await shareOwn(
    tx,
    schema.tags,
    userId,
    parents((op) => (op.op === "addTag" || op.op === "removeTag" ? op.tagId : undefined)),
  );

  const ids = uniqueSorted(ops.flatMap((op) => op.ids));
  const restoreIds = uniqueSorted(ops.flatMap((op) => (op.op === "restore" ? op.ids : [])));
  let productIds: string[] = [];
  if (restoreIds.length > 0) {
    // An item's product never changes: reading it before the row lock is safe.
    const rows = await tx
      .select({ productId: schema.items.productId })
      .from(schema.items)
      .where(and(inArray(schema.items.id, restoreIds), eq(schema.items.userId, userId)));
    productIds = uniqueSorted(rows.flatMap((r) => (r.productId ? [r.productId] : [])));
    for (const productId of productIds) await lockProductOfUser(tx, userId, productId);
  }
  const scope =
    productIds.length > 0
      ? sql`(${inArray(schema.items.id, ids)} or (${inArray(schema.items.productId, productIds)} and ${isNull(schema.items.deletedAt)}))`
      : inArray(schema.items.id, ids);
  const locked = await tx
    .select({ id: schema.items.id })
    .from(schema.items)
    .where(and(eq(schema.items.userId, userId), scope))
    .orderBy(asc(schema.items.id))
    .for("update");
  const lockedIds = new Set(locked.map((r) => r.id));
  if (ids.some((id) => !lockedIds.has(id))) throw new BulkError("not_found");
}

/** Her items of the op, in the op's order (already locked); 404 when one is missing (merged by an earlier op). */
async function loadItems(tx: Tx, userId: string, ids: string[]): Promise<Item[]> {
  const rows = await tx
    .select()
    .from(schema.items)
    .where(and(inArray(schema.items.id, ids), eq(schema.items.userId, userId)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => {
    const row = byId.get(id);
    if (!row) throw new BulkError("not_found");
    return row;
  });
}

function requireActive(items: Item[]) {
  if (items.some((item) => item.deletedAt)) throw new BulkError("item_deleted");
}

const result = (changed: string[], undoOps: ItemBulk[] = [], eventIds: string[] = []): OpResult => ({
  changed,
  undoOps,
  eventIds,
  trace: emptyTrace(),
});

async function setItems(tx: Tx, ids: string[], set: Partial<typeof schema.items.$inferInsert>) {
  if (ids.length > 0) await tx.update(schema.items).set(set).where(inArray(schema.items.id, ids));
}

/** One op of a batch or of an undo, on rows locked by `lockFor`. Only the items it really changes count. */
async function applyOp(tx: Tx, userId: string, op: ItemBulk, options: OpOptions): Promise<OpResult> {
  const { now } = options;
  const items = await loadItems(tx, userId, op.ids);
  switch (op.op) {
    case "stage": {
      requireActive(items);
      const changed = items.filter((item) => item.stage !== op.stage);
      if (changed.length === 0) return result([]);
      const values: ItemFieldValues = {};
      const column = AMOUNT_COLUMN[op.stage];
      if (column && op.amountCents !== undefined) values[column] = op.amountCents;
      if (op.channel !== undefined && (op.stage === "for_sale" || op.stage === "sold")) values.saleChannel = op.channel;
      // Out of « Repéré », out of the order selection (spec §3.6); the undo below selects them again.
      if (op.stage !== "spotted") values.inOrderDraft = false;
      const ids = changed.map((item) => item.id);
      await setItems(tx, ids, { ...values, stage: op.stage, updatedAt: now });
      let eventIds: string[] = [];
      if (options.writeEvents) {
        const at = new Date(op.at);
        const spent = await spentCentsFor(
          tx,
          ids,
          op.stage,
          op.amountCents,
          new Map(changed.map((item) => [item.id, item.stage as ItemStage])),
        );
        const rows = await tx
          .insert(schema.itemEvents)
          .values(
            ids.map((itemId) => ({
              itemId,
              type: "stage",
              stage: op.stage,
              at,
              amountCents: op.amountCents ?? null,
              spentCents: spent.get(itemId) ?? null,
            })),
          )
          .returning({ id: schema.itemEvents.id });
        eventIds = rows.map((r) => r.id);
      }
      // The previous stage, then the previous amounts, channel and selection (ruling R9). The undo writes no history
      // row, so its `at` is only there for the schema.
      const undoOps: ItemBulk[] = [
        ...groupIds(changed.map((item) => ({ id: item.id, key: item.stage as ItemStage }))).map(
          ([stage, stageIds]): ItemBulk => ({ ids: stageIds, op: "stage", stage, at: now.toISOString() }),
        ),
        ...setFieldsUndo(changed, values),
        ...untakeUndo(changed, op.stage),
      ];
      return {
        ...result(ids, undoOps, eventIds),
        trace: { stageChanges: changed.map((item) => ({ from: item.stage as ItemStage, to: op.stage })), moves: 0 },
      };
    }
    case "move": {
      requireActive(items);
      const changed = items.filter((item) => item.profileId !== op.profileId);
      if (changed.length === 0) return result([]);
      const ids = changed.map((item) => item.id);
      // Another profile, out of this profile's order selection (spec §3.6).
      await setItems(tx, ids, { profileId: op.profileId, inOrderDraft: false, updatedAt: now });
      let eventIds: string[] = [];
      if (options.writeEvents) {
        const rows = await tx
          .insert(schema.itemEvents)
          .values(
            changed.map((item) => ({
              itemId: item.id,
              type: "profile",
              fromProfileId: item.profileId,
              toProfileId: op.profileId,
              at: now,
            })),
          )
          .returning({ id: schema.itemEvents.id });
        eventIds = rows.map((r) => r.id);
      }
      const undoOps = [
        ...groupIds(changed.map((item) => ({ id: item.id, key: item.profileId }))).map(
          ([profileId, groupIdsOf]): ItemBulk => ({ ids: groupIdsOf, op: "move", profileId }),
        ),
        ...reselectUndo(changed),
      ];
      return { ...result(ids, undoOps, eventIds), trace: { stageChanges: [], moves: ids.length } };
    }
    case "addToList": {
      requireActive(items);
      const present = await tx
        .select({ itemId: schema.wishlistItems.itemId })
        .from(schema.wishlistItems)
        .where(and(eq(schema.wishlistItems.wishlistId, op.wishlistId), inArray(schema.wishlistItems.itemId, op.ids)));
      const already = new Set(present.map((r) => r.itemId));
      const ids = op.ids.filter((id) => !already.has(id));
      if (ids.length === 0) return result([]);
      const [last] = await tx
        .select({ max: sql<number | null>`max(${schema.wishlistItems.position})` })
        .from(schema.wishlistItems)
        .where(eq(schema.wishlistItems.wishlistId, op.wishlistId));
      const base = last?.max === null || last?.max === undefined ? 0 : Number(last.max) + 1;
      // Her friends' gifts kept from when she took them off are ordinary again.
      await clearGiftsRemoved(tx, op.wishlistId, ids);
      const added = await tx
        .insert(schema.wishlistItems)
        .values(ids.map((itemId, i) => ({ wishlistId: op.wishlistId, itemId, position: base + i, addedAt: now })))
        .onConflictDoNothing()
        .returning({ itemId: schema.wishlistItems.itemId });
      const addedIds = added.map((r) => r.itemId);
      return result(
        addedIds,
        addedIds.length ? [{ ids: addedIds, op: "removeFromList", wishlistId: op.wishlistId }] : [],
      );
    }
    case "removeFromList": {
      requireActive(items);
      // Before the delete (lock order, see markGiftsRemoved). Only items on the list have unmarked gifts.
      await markGiftsRemoved(tx, op.wishlistId, op.ids);
      const removed = await tx
        .delete(schema.wishlistItems)
        .where(and(eq(schema.wishlistItems.wishlistId, op.wishlistId), inArray(schema.wishlistItems.itemId, op.ids)))
        .returning({ itemId: schema.wishlistItems.itemId });
      const ids = removed.map((r) => r.itemId);
      return result(ids, ids.length ? [{ ids, op: "addToList", wishlistId: op.wishlistId }] : []);
    }
    case "addTag": {
      requireActive(items);
      const added = await tx
        .insert(schema.itemTags)
        .values(op.ids.map((itemId) => ({ itemId, tagId: op.tagId })))
        .onConflictDoNothing()
        .returning({ itemId: schema.itemTags.itemId });
      const ids = added.map((r) => r.itemId);
      return result(ids, ids.length ? [{ ids, op: "removeTag", tagId: op.tagId }] : []);
    }
    case "removeTag": {
      requireActive(items);
      const removed = await tx
        .delete(schema.itemTags)
        .where(and(eq(schema.itemTags.tagId, op.tagId), inArray(schema.itemTags.itemId, op.ids)))
        .returning({ itemId: schema.itemTags.itemId });
      const ids = removed.map((r) => r.itemId);
      return result(ids, ids.length ? [{ ids, op: "addTag", tagId: op.tagId }] : []);
    }
    case "setFields": {
      requireActive(items);
      const values = Object.fromEntries(
        Object.entries(op.fields).filter(([, value]) => value !== undefined),
      ) as ItemFieldValues;
      await checkReferences(tx, op.ids, values);
      const changed = items.filter((item) => changedFields(item, values).length > 0);
      const ids = changed.map((item) => item.id);
      await setItems(tx, ids, { ...values, updatedAt: now });
      // Out of her selection while still a wish (untick, or the undo of « Je le prends »): the take is withdrawn.
      if (values.inOrderDraft === false)
        await clearOwnerTook(
          tx,
          changed.filter((item) => item.inOrderDraft && item.stage === "spotted").map((item) => item.id),
        );
      return result(ids, setFieldsUndo(changed, values));
    }
    case "unreceiveGift": {
      // Undo of « Reçu en cadeau » (after the stage op that puts the item back): gifts active again, names cleared.
      requireActive(items);
      const back = new Set(await unreceiveGifts(tx, op.ids));
      const named = items
        .filter((item) => item.giftFrom !== null || item.giftReceivedAt !== null)
        .map((item) => item.id);
      await setItems(tx, named, { giftFrom: null, giftReceivedAt: null, updatedAt: now });
      return result(op.ids.filter((id) => back.has(id) || named.includes(id)));
    }
    case "untakeGift": {
      // Undo of a purchase from her wishes (after the stage op): her friends no longer see « pris elle-même ».
      requireActive(items);
      await clearOwnerTook(tx, op.ids);
      return result([]);
    }
    case "delete": {
      const trashed = items.filter((item) => !item.deletedAt);
      const ids = trashed.map((item) => item.id);
      // In the trash, out of the order selection (spec §3.6); the undo restores, then selects again.
      await setItems(tx, ids, { deletedAt: now, inOrderDraft: false, updatedAt: now });
      return result(ids, ids.length ? [{ ids, op: "restore" }, ...reselectUndo(trashed)] : []);
    }
    case "restore": {
      // As the single restore: when she keeps the same product again meanwhile, the two are merged into the active
      // item (no undo for a merge); otherwise the item comes back and its undo is the trash.
      const changed = new Set<string>();
      const restored: string[] = [];
      const merged: string[] = [];
      for (const item of items) {
        if (!item.deletedAt) continue;
        if (!item.productId) throw new Error("items without a product come with 2b");
        const [active] = await tx
          .select()
          .from(schema.items)
          .where(
            and(
              eq(schema.items.userId, userId),
              eq(schema.items.productId, item.productId),
              isNull(schema.items.deletedAt),
            ),
          );
        if (active) {
          await mergeItemInto(tx, item, active, now);
          changed.add(active.id);
          merged.push(item.id);
        } else {
          await setItems(tx, [item.id], { deletedAt: null, updatedAt: now });
          changed.add(item.id);
          restored.push(item.id);
        }
      }
      return { ...result([...changed], restored.length ? [{ ids: restored, op: "delete" }] : []), merged };
    }
  }
}

/** The cover must be a photo of every item; the category and colour must exist (as PATCH). */
async function checkReferences(tx: Tx, ids: string[], values: ItemFieldValues) {
  if (values.coverMediaId) {
    const photos = await tx
      .select({ itemId: schema.itemMedia.itemId })
      .from(schema.itemMedia)
      .where(and(eq(schema.itemMedia.mediaId, values.coverMediaId), inArray(schema.itemMedia.itemId, ids)));
    if (new Set(photos.map((p) => p.itemId)).size !== ids.length) throw new BulkError("invalid_cover");
  }
  if (values.categoryId) {
    const [row] = await tx
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(eq(schema.categories.id, values.categoryId));
    if (!row) throw new BulkError("invalid_category");
  }
  if (values.colorId) {
    const [row] = await tx
      .select({ id: schema.colors.id })
      .from(schema.colors)
      .where(eq(schema.colors.id, values.colorId));
    if (!row) throw new BulkError("invalid_color");
  }
}

/**
 * `POST /items/bulk`: one op on up to 200 of her items, in one transaction, all or nothing. Returns the ids actually
 * changed and the undo (inverse ops grouped by previous value, and the history rows written).
 */
export async function runBulk(db: Database, userId: string, op: ItemBulk, now: Date): Promise<BulkOutcome> {
  return inTransaction(db, async (tx) => {
    await lockFor(tx, userId, [op]);
    const done = await applyOp(tx, userId, op, { now, writeEvents: true });
    return {
      itemIds: done.changed,
      undo: done.undoOps.length > 0 ? { ops: done.undoOps, removeEventIds: done.eventIds } : null,
      trace: done.trace,
    };
  });
}

/**
 * `POST /items/undo`: replays the ops in order through the same code as the batches, without writing history, then
 * deletes the history rows the action wrote. One transaction; an item, profile, list, tag or history row that is not
 * hers answers 404 and nothing changes. An undo has no undo.
 */
export async function runUndo(db: Database, userId: string, payload: UndoPayload, now: Date): Promise<BulkOutcome> {
  return inTransaction(db, async (tx) => {
    await lockFor(tx, userId, payload.ops);
    const changed = new Set<string>();
    // An item merged into an active one by a restore is gone: the ops after it (selecting it again) skip it.
    const gone = new Set<string>();
    for (const op of payload.ops) {
      const ids = op.ids.filter((id) => !gone.has(id));
      if (ids.length === 0) continue;
      const done = await applyOp(tx, userId, { ...op, ids }, { now, writeEvents: false });
      for (const id of done.changed) changed.add(id);
      for (const id of done.merged ?? []) gone.add(id);
    }
    const eventIds = [...new Set(payload.removeEventIds)];
    if (eventIds.length > 0) {
      const removed = await tx
        .delete(schema.itemEvents)
        .where(
          and(
            inArray(schema.itemEvents.id, eventIds),
            inArray(
              schema.itemEvents.itemId,
              tx.select({ id: schema.items.id }).from(schema.items).where(eq(schema.items.userId, userId)),
            ),
          ),
        )
        .returning({ id: schema.itemEvents.id });
      if (removed.length !== eventIds.length) throw new BulkError("not_found");
    }
    return { itemIds: [...changed], undo: null, trace: emptyTrace() };
  });
}

/**
 * `POST /me/order-draft/ordered` (spec §3.6): her selected wishes still « Repéré » and active — of the profile, or in
 * the list — go to « Commandé » today, in one transaction, through the bulk `stage` op (history rows with the amount
 * counted in the budgets), which also takes them out of the selection. Undo: back to « Repéré », selected again, and
 * the history rows deleted. 404 for a profile or list not hers; 409 `order_draft_empty` when nothing is selected;
 * 409 `order_draft_too_large` beyond 200 items (one action, one undo: the undo payload holds at most 200 items).
 */
export async function runOrderDraft(
  db: Database,
  userId: string,
  input: OrderDraftInput,
  now: Date,
): Promise<BulkOutcome> {
  return inTransaction(db, async (tx) => {
    // Lock order as the batches: the parent row (shared), then the item rows by id.
    if ("profileId" in input) await shareOwn(tx, schema.profiles, userId, [input.profileId]);
    else await shareOwn(tx, schema.wishlists, userId, [input.wishlistId]);
    const scope =
      "profileId" in input
        ? eq(schema.items.profileId, input.profileId)
        : inArray(
            schema.items.id,
            tx
              .select({ id: schema.wishlistItems.itemId })
              .from(schema.wishlistItems)
              .where(eq(schema.wishlistItems.wishlistId, input.wishlistId)),
          );
    // Locked and filtered in the same statement: a row changed meanwhile is checked again once its lock is held.
    const selected = await tx
      .select({ id: schema.items.id })
      .from(schema.items)
      .where(
        and(
          eq(schema.items.userId, userId),
          isNull(schema.items.deletedAt),
          eq(schema.items.inOrderDraft, true),
          eq(schema.items.stage, "spotted"),
          scope,
        ),
      )
      .orderBy(asc(schema.items.id))
      .for("update");
    if (selected.length === 0) throw new BulkError("order_draft_empty");
    if (selected.length > MAX_BULK_ITEMS) throw new BulkError("order_draft_too_large");
    const op: ItemBulk = { ids: selected.map((r) => r.id), op: "stage", stage: "ordered", at: now.toISOString() };
    const done = await applyOp(tx, userId, op, { now, writeEvents: true });
    return {
      itemIds: done.changed,
      undo: { ops: done.undoOps, removeEventIds: done.eventIds },
      trace: done.trace,
    };
  });
}
