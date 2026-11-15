import { and, type Database, eq, gt, isNull, lt, schema, sql } from "@closyria/db";
import {
  inboundEmailPurge,
  inboundEmailStatusSchema,
  rawEmailKey,
  STUCK_INBOUND_EMAIL_MINUTES,
} from "@closyria/shared";
import type { ObjectStore } from "@closyria/storage";

/** Rows read at a time; the purge goes on until nothing is left. */
const BATCH = 500;

export type InboundPurgeResult = {
  /** Rows deleted (ignored ones, failed ones no order points to). */
  deleted: number;
  /** Rows kept without their raw message. */
  cleared: number;
  /** Rows left `queued` without a message, now `failed`. */
  failed: number;
};

const errorName = (error: unknown) => (error instanceof Error ? error.name : "error");

/**
 * The 30-day purge of received e-mails (spec §5): past `purge_after`, `inboundEmailPurge` decides for each one. An
 * ignored one, or a failed one no order points to, is deleted; the others keep their row and lose their raw message.
 * The object goes first: a row changes only once its object is really deleted (a store failure is logged, the row
 * waits for the next night, never an orphan object nobody points to any more).
 *
 * Also fails what the reception left half done: an accepted e-mail still `queued` without its raw message an hour
 * later (the reception could not mark it failed), its object (if any landed) deleted first.
 */
export async function purgeInboundEmails(db: Database, now: Date, store: ObjectStore): Promise<InboundPurgeResult> {
  const e = schema.inboundEmails;
  const result: InboundPurgeResult = { deleted: 0, cleared: 0, failed: 0 };
  const removed = async (key: string) => {
    try {
      await store.delete(key);
      return true;
    } catch (error) {
      console.error(`inbound e-mail purge: object not deleted, kept for the next run (${errorName(error)})`);
      return false;
    }
  };

  const stuckBefore = new Date(now.getTime() - STUCK_INBOUND_EMAIL_MINUTES * 60_000);
  for (let after = "00000000-0000-0000-0000-000000000000"; ; ) {
    const rows = await db
      .select({ id: e.id, userId: e.userId })
      .from(e)
      .where(
        and(
          eq(e.status, "queued"),
          isNull(e.rawObjectKey),
          lt(e.receivedAt, stuckBefore),
          // Not one whose message the 30-day purge already erased.
          gt(e.purgeAfter, now),
          gt(e.id, after),
        ),
      )
      .orderBy(e.id)
      .limit(BATCH);
    for (const row of rows) {
      if (row.userId && !(await removed(rawEmailKey(row.userId, row.id)))) continue;
      const changed = await db
        .update(e)
        .set({ status: "failed" })
        .where(and(eq(e.id, row.id), eq(e.status, "queued"), isNull(e.rawObjectKey)))
        .returning({ id: e.id });
      result.failed += changed.length;
    }
    if (rows.length < BATCH) break;
    after = (rows[rows.length - 1] as { id: string }).id;
  }

  // Qualified by hand: drizzle may print `${e.id}` as a bare "id", which inside the subquery is the order's own.
  const referenced = sql<boolean>`exists (select 1 from orders o where o.inbound_email_id = inbound_emails.id)`;
  for (let after = "00000000-0000-0000-0000-000000000000"; ; ) {
    // Only rows with something to do: one to delete, or a raw message still kept.
    const rows = await db
      .select({ id: e.id, status: e.status, key: e.rawObjectKey, referenced })
      .from(e)
      .where(
        sql`${e.purgeAfter} <= ${now} and ${e.id} > ${after} and (${e.rawObjectKey} is not null or ${e.status} = 'ignored' or (${e.status} = 'failed' and not ${referenced}))`,
      )
      .orderBy(e.id)
      .limit(BATCH);
    for (const row of rows) {
      if (row.key && !(await removed(row.key))) continue;
      // Unchanged since it was read (same message key), or nothing is done.
      const same = row.key ? eq(e.rawObjectKey, row.key) : isNull(e.rawObjectKey);
      if (inboundEmailPurge(inboundEmailStatusSchema.parse(row.status), row.referenced) === "delete") {
        const gone = await db
          .delete(e)
          .where(and(eq(e.id, row.id), same))
          .returning({ id: e.id });
        result.deleted += gone.length;
      } else {
        const changed = await db
          .update(e)
          .set({ rawObjectKey: null })
          .where(and(eq(e.id, row.id), same))
          .returning({ id: e.id });
        result.cleared += changed.length;
      }
    }
    if (rows.length < BATCH) break;
    after = (rows[rows.length - 1] as { id: string }).id;
  }
  return result;
}
