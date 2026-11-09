import { and, type Database, desc, eq, schema } from "@closyria/db";
import type { ItemBulk, ItemStage } from "@closyria/shared";
import { recordEvent } from "./events";
import { isGiven, receiveGifts } from "./gifts";
import { type ItemOutcome, lockOwnItem } from "./items";
import { type ItemFieldValues, setFieldsUndo } from "./undo";

/**
 * « Reçu en cadeau » (`POST /me/items/{id}/received-as-gift`): the item goes to « Reçu » (a history row, as any stage
 * change, counting nothing in the budgets), marked a gift (`gift_received_at`) with the givers' names frozen in
 * `gift_from` (null: « Offert par une amie »), and her friends' gifts of it are over on every list. Already « Reçu » and not a gift yet: only the names.
 * The undo is the stage change's, plus `unreceiveGift` (gifts back, names cleared); it never carries a name.
 * `same_stage` when it is a gift already.
 */
export async function receiveAsGift(db: Database, userId: string, itemId: string, now: Date): Promise<ItemOutcome> {
  return db.transaction(async (tx): Promise<ItemOutcome> => {
    // Lock order as the batches: the item row, then the gift locks (see markGiftsRemoved).
    const item = await lockOwnItem(tx, userId, itemId);
    if (!item) return { error: "not_found" };
    if (item.deletedAt) return { error: "item_deleted" };
    if (isGiven(item)) return { error: "same_stage" };
    const giftFrom = await receiveGifts(tx, item.id);
    const moves = item.stage !== "owned";
    const values: ItemFieldValues = moves ? { inOrderDraft: false } : {};
    await tx
      .update(schema.items)
      .set({ ...values, ...(moves ? { stage: "owned" } : {}), giftFrom, giftReceivedAt: now, updatedAt: now })
      .where(eq(schema.items.id, item.id));
    const ops: ItemBulk[] = [];
    const removeEventIds: string[] = [];
    if (moves) {
      const [previousEvent] = await tx
        .select({ at: schema.itemEvents.at })
        .from(schema.itemEvents)
        .where(
          and(
            eq(schema.itemEvents.itemId, item.id),
            eq(schema.itemEvents.type, "stage"),
            eq(schema.itemEvents.stage, item.stage),
          ),
        )
        .orderBy(desc(schema.itemEvents.at), desc(schema.itemEvents.createdAt))
        .limit(1);
      removeEventIds.push(await recordEvent(tx, item, { type: "stage", stage: "owned", at: now, amountCents: null }));
      const previousAt = (previousEvent?.at ?? item.createdAt).toISOString();
      ops.push({ ids: [item.id], op: "stage", stage: item.stage as ItemStage, at: previousAt });
      ops.push(...setFieldsUndo([item], values));
    }
    ops.push({ ids: [item.id], op: "unreceiveGift" });
    return { itemId: item.id, itemIds: [item.id], undo: { ops, removeEventIds }, previous: item };
  });
}
