import { type Database, schema } from "@closyria/db";
import type { ItemStage } from "@closyria/shared";
import { spentCentsFor } from "./spent";

/** A transaction handed to `db.transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type ItemEventInput =
  | { type: "stage"; stage: ItemStage; at: Date; amountCents?: number | null }
  | { type: "profile"; fromProfileId: string; toProfileId: string; at: Date };

/** Writes one history row (`item_events`) for the item and returns its id (undo deletes it, ruling R4). */
export async function recordEvent(tx: Tx, item: { id: string }, event: ItemEventInput): Promise<string> {
  const spentCents =
    event.type === "stage"
      ? ((await spentCentsFor(tx, [item.id], event.stage, event.amountCents)).get(item.id) ?? null)
      : null;
  const [row] = await tx
    .insert(schema.itemEvents)
    .values(
      event.type === "stage"
        ? {
            itemId: item.id,
            type: "stage",
            stage: event.stage,
            at: event.at,
            amountCents: event.amountCents ?? null,
            spentCents,
          }
        : {
            itemId: item.id,
            type: "profile",
            fromProfileId: event.fromProfileId,
            toProfileId: event.toProfileId,
            at: event.at,
            spentCents,
          },
    )
    .returning({ id: schema.itemEvents.id });
  if (!row) throw new Error("item event not inserted");
  return row.id;
}
