import { type Database, inArray, schema, sql } from "@closyria/db";
import { inboundEmailPurge, inboundEmailStatusSchema } from "@closyria/shared";
import type { ObjectStore } from "@closyria/storage";

/** Rows handled per transaction; the purge goes on until nothing is left. */
const BATCH = 500;

/**
 * The 30-day purge of received e-mails (spec §5): past `purge_after`, `inboundEmailPurge` decides for each one. An
 * ignored one, or a failed one no order points to, is deleted; the others keep their row and lose their raw message.
 * The stored objects go after the commit, a failure there is logged (an orphan object), never thrown. Rows locked by a
 * reception or an account deletion in progress are skipped, for the next night.
 */
export async function purgeInboundEmails(
  db: Database,
  now: Date,
  store: ObjectStore,
): Promise<{ deleted: number; cleared: number }> {
  const e = schema.inboundEmails;
  // Qualified by hand: drizzle may print `${e.id}` as a bare "id", which inside the subquery is the order's own.
  const referenced = sql<boolean>`exists (select 1 from orders o where o.inbound_email_id = inbound_emails.id)`;
  let deleted = 0;
  let cleared = 0;
  for (;;) {
    const { keys, size } = await db.transaction(async (tx) => {
      // Only rows with something to do: one to delete, or a raw message still kept.
      const rows = await tx
        .select({ id: e.id, status: e.status, key: e.rawObjectKey, referenced })
        .from(e)
        .where(
          sql`${e.purgeAfter} <= ${now} and (${e.rawObjectKey} is not null or ${e.status} = 'ignored' or (${e.status} = 'failed' and not ${referenced}))`,
        )
        .limit(BATCH)
        .for("update", { skipLocked: true });
      const remove: string[] = [];
      const clear: string[] = [];
      for (const row of rows) {
        const action = inboundEmailPurge(inboundEmailStatusSchema.parse(row.status), row.referenced);
        (action === "delete" ? remove : clear).push(row.id);
      }
      if (remove.length > 0) await tx.delete(e).where(inArray(e.id, remove));
      if (clear.length > 0) await tx.update(e).set({ rawObjectKey: null }).where(inArray(e.id, clear));
      deleted += remove.length;
      cleared += clear.length;
      return { keys: rows.flatMap((r) => (r.key ? [r.key] : [])), size: rows.length };
    });
    for (const key of keys) {
      await store
        .delete(key)
        .catch((error: unknown) =>
          console.error(`inbound e-mail purge: object not deleted (${error instanceof Error ? error.name : "error"})`),
        );
    }
    if (size < BATCH) break;
  }
  return { deleted, cleared };
}
