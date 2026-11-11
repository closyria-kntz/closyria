import { and, eq, type SQL, schema, sql } from "@closyria/db";
import { RECEIVED_DAYS } from "@closyria/shared";
import { parisDayStart } from "./budgets";

/**
 * « Reçu » or « Dans mon dressing » (founder, 2026-11-11): an `owned` item is « Reçu » while her most recent move to
 * `owned` (its `item_events` row) is less than RECEIVED_DAYS Paris days old. Without such a row: « Dans mon dressing ».
 * The list, the counts and the item view all use this rule, never the browser.
 */

/** The earliest move to `owned` that is still « Reçu » at `now`: 00:00 in Paris, RECEIVED_DAYS − 1 days before today. */
export const receivedSince = (now: Date): Date => parisDayStart(now, -(RECEIVED_DAYS - 1));

/** The date of the item's most recent move to `owned` (null without one). */
export const lastOwnedAt = sql`(select max(${schema.itemEvents.at}) from ${schema.itemEvents} where ${schema.itemEvents.itemId} = ${schema.items.id} and ${schema.itemEvents.type} = 'stage' and ${schema.itemEvents.stage} = 'owned')`;

/** `owned` and « Reçu » at `now`. */
export const isReceived = (now: Date): SQL =>
  and(eq(schema.items.stage, "owned"), sql`${lastOwnedAt} >= ${receivedSince(now).toISOString()}`) as SQL;

/** `owned` and « Dans mon dressing » at `now` (never moved there counts as long ago). */
export const isInDressing = (now: Date): SQL =>
  and(
    eq(schema.items.stage, "owned"),
    sql`coalesce(${lastOwnedAt} < ${receivedSince(now).toISOString()}, true)`,
  ) as SQL;
