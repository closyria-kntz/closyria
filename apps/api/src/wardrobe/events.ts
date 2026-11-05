import { type Database, schema } from "@closyria/db";
import type { ItemStage } from "@closyria/shared";

/** A transaction handed to `db.transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type ItemEventInput =
  | { type: "stage"; stage: ItemStage; at: Date; amountCents?: number | null }
  | { type: "profile"; fromProfileId: string; toProfileId: string; at: Date };

/** Writes one history row (`item_events`) for the item and returns its id (undo deletes it, ruling R4). */
export async function recordEvent(tx: Tx | Database, item: { id: string }, event: ItemEventInput): Promise<string> {
  const [row] = await tx
    .insert(schema.itemEvents)
    .values(
      event.type === "stage"
        ? { itemId: item.id, type: "stage", stage: event.stage, at: event.at, amountCents: event.amountCents ?? null }
        : {
            itemId: item.id,
            type: "profile",
            fromProfileId: event.fromProfileId,
            toProfileId: event.toProfileId,
            at: event.at,
          },
    )
    .returning({ id: schema.itemEvents.id });
  if (!row) throw new Error("item event not inserted");
  return row.id;
}
