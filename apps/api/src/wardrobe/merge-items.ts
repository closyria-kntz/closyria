import { eq, schema, sql } from "@closyria/db";
import { ITEM_STAGE_ORDER, type ItemStage } from "@closyria/shared";
import type { Tx } from "./events";

type Item = typeof schema.items.$inferSelect;

/** Her own fields: the target's value is kept, the source's fills it only when the target has none. */
const KEPT_UNLESS_EMPTY = [
  "sizeLabel",
  "sizeNote",
  "notes",
  "pricePaidCents",
  "salePriceCents",
  "saleChannel",
  "nameOverride",
  "brandOverride",
  "categoryId",
  "colorId",
  "coverMediaId",
  "why",
] as const satisfies (keyof Item)[];

/**
 * Merges `source` into `target`, two items of the same user for the same product (spec §3 « Fusion », G2): the most
 * advanced stage (`ITEM_STAGE_ORDER`, the target's on a tie), the highest level (none lowest), priority and order
 * selection if either has them, the target's own fields (opinion included) unless
 * empty, and the union of photos, lists, tags, history and photo imports; then deletes `source`. Nothing is lost: the merged item
 * may hold more than 10 photos (the cap is checked on upload only). Runs inside the caller's transaction.
 */
export async function mergeItemInto(tx: Tx, source: Item, target: Item, now: Date): Promise<void> {
  const sourceStage = source.stage as ItemStage;
  const targetStage = target.stage as ItemStage;
  const patch: Partial<typeof schema.items.$inferInsert> = {
    stage: ITEM_STAGE_ORDER[sourceStage] > ITEM_STAGE_ORDER[targetStage] ? sourceStage : targetStage,
    loveLevel: Math.max(source.loveLevel ?? 0, target.loveLevel ?? 0) || null,
    priority: source.priority || target.priority,
    inOrderDraft: source.inOrderDraft || target.inOrderDraft,
    updatedAt: now,
  };
  for (const field of KEPT_UNLESS_EMPTY) {
    const value = target[field] === null || target[field] === "" ? source[field] : target[field];
    Object.assign(patch, { [field]: value });
  }

  // Photos: the source's that the target lacks go after the target's (same media twice: kept once).
  await tx.execute(sql`
    update ${schema.itemMedia} as m
    set item_id = ${target.id},
        position = m.position + 1 + coalesce((select max(position) from ${schema.itemMedia} where item_id = ${target.id}), -1)
    where m.item_id = ${source.id}
      and m.media_id not in (select media_id from ${schema.itemMedia} where item_id = ${target.id})`);
  await tx.execute(sql`
    insert into ${schema.wishlistItems} (wishlist_id, item_id, position, added_at)
    select wishlist_id, ${target.id}, position, added_at from ${schema.wishlistItems} where item_id = ${source.id}
    on conflict do nothing`);
  await tx.execute(sql`
    insert into ${schema.itemTags} (item_id, tag_id)
    select ${target.id}, tag_id from ${schema.itemTags} where item_id = ${source.id}
    on conflict do nothing`);
  await tx.update(schema.itemEvents).set({ itemId: target.id }).where(eq(schema.itemEvents.itemId, source.id));
  // Photo imports follow: a `ready` one would otherwise go with the source (cascade) and its object would leak.
  await tx
    .update(schema.photoImports)
    .set({ itemId: target.id, updatedAt: now })
    .where(eq(schema.photoImports.itemId, source.id));
  // Lists, tags and remaining duplicate photos of the source go with it (cascade).
  await tx.delete(schema.items).where(eq(schema.items.id, source.id));
  await tx.update(schema.items).set(patch).where(eq(schema.items.id, target.id));
}
