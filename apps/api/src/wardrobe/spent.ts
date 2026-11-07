import { and, desc, eq, inArray, schema } from "@closyria/db";
import type { ItemStage } from "@closyria/shared";
import type { Tx } from "./events";

/**
 * What a stage change counts in the budgets (`item_events.spent_cents`), per item.
 * `ordered`: the amount typed in that change, else the product's current price, else null (counts as 0).
 * `returned`: what the item's latest `ordered` event counted, null when it has none.
 * `spotted`, from `ordered` only (put back in the wishes): the same credit as a return. Any other stage: null.
 */
export async function spentCentsFor(
  tx: Tx,
  itemIds: string[],
  stage: ItemStage,
  amountCents: number | null | undefined,
  previousStages: Map<string, ItemStage> = new Map(),
): Promise<Map<string, number | null>> {
  const spent = new Map<string, number | null>(itemIds.map((id) => [id, null]));
  if (itemIds.length === 0) return spent;
  if (stage === "ordered") {
    if (amountCents != null) return new Map(itemIds.map((id) => [id, amountCents]));
    const rows = await tx
      .select({ id: schema.items.id, priceCents: schema.products.priceCents })
      .from(schema.items)
      .innerJoin(schema.products, eq(schema.products.id, schema.items.productId))
      .where(inArray(schema.items.id, itemIds));
    for (const row of rows) spent.set(row.id, row.priceCents);
  } else if (stage === "returned" || stage === "spotted") {
    const creditIds = stage === "returned" ? itemIds : itemIds.filter((id) => previousStages.get(id) === "ordered");
    if (creditIds.length === 0) return spent;
    const rows = await tx
      .select({ itemId: schema.itemEvents.itemId, spentCents: schema.itemEvents.spentCents })
      .from(schema.itemEvents)
      .where(
        and(
          inArray(schema.itemEvents.itemId, creditIds),
          eq(schema.itemEvents.type, "stage"),
          eq(schema.itemEvents.stage, "ordered"),
        ),
      )
      .orderBy(desc(schema.itemEvents.at), desc(schema.itemEvents.createdAt));
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.itemId)) continue;
      seen.add(row.itemId);
      spent.set(row.itemId, row.spentCents);
    }
  }
  return spent;
}
