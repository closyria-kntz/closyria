import { type Database, eq, schema, sql } from "@closyria/db";
import type { ObjectStore } from "@closyria/storage";

/** Stored objects deleted at the same time (S3 requests in flight). */
export const OBJECT_DELETE_CONCURRENCY = 8;

/** Who asked for the deletion, written to the audit log in the same transaction. */
export type DeletionAudit = { adminId: string; method: string; path: string };

export type DeletionOutcome = "deleted" | "not_found" | "admin";

/**
 * Deletes a person and everything she owns (RGPD, « Supprimer ce compte »). One transaction removes the `user` row;
 * every table holding her data has a foreign key to `user(id)` ON DELETE CASCADE (the owned tables registry checks it,
 * owned-tables.test.ts), so her rows go with it: wardrobe, photos, lists, alerts, events, sessions, sign-in methods.
 * Records that outlive her keep no link (audit log, capture log: ON DELETE SET NULL). Her pending sign-in codes go too.
 *
 * The admin audit row (`user.delete`, `user:<id>`, `{ guest }`, never her e-mail) is written in the same transaction:
 * no deletion without its record, no record of a deletion that did not happen. An admin account is never deleted
 * (checked again under the row lock).
 *
 * Her stored photos (`media`, and photo imports nobody attached yet) are deleted from object storage after the commit,
 * a few at a time, so a storage failure (logged, never thrown) cannot undo the deletion; it only leaves an orphan file.
 */
export async function deleteUserAccount(
  db: Database,
  store: ObjectStore,
  userId: string,
  audit: DeletionAudit,
): Promise<DeletionOutcome> {
  const outcome = await db.transaction(async (tx) => {
    const [found] = await tx
      .select({ email: schema.user.email, role: schema.user.role, isAnonymous: schema.user.isAnonymous })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .for("update");
    if (!found) return "not_found" as const;
    if (found.role === "admin") return "admin" as const;
    const media = await tx.select({ key: schema.media.key }).from(schema.media).where(eq(schema.media.userId, userId));
    const imports = await tx
      .select({ key: schema.photoImports.mediaKey })
      .from(schema.photoImports)
      .where(sql`${schema.photoImports.userId} = ${userId} and ${schema.photoImports.status} = 'ready'`);
    // Better Auth's sign-in codes are keyed `<type>-otp-<email>`, not linked to the user row.
    await tx.execute(
      sql`delete from ${schema.verification} where right(${schema.verification.identifier}, ${found.email.length + 5}) = ${`-otp-${found.email.toLowerCase()}`}`,
    );
    await tx.delete(schema.user).where(eq(schema.user.id, userId));
    await tx.insert(schema.adminAuditLog).values({
      adminId: audit.adminId,
      action: "user.delete",
      target: `user:${userId}`,
      details: { guest: found.isAnonymous === true, method: audit.method, path: audit.path, status: 204 },
    });
    return [...new Set([...media.map((m) => m.key), ...imports.flatMap((i) => (i.key ? [i.key] : []))])];
  });
  if (!Array.isArray(outcome)) return outcome;
  await deleteObjects(store, outcome);
  return "deleted";
}

/** Deletes the keys, at most `OBJECT_DELETE_CONCURRENCY` at a time; a failure is logged and the others go on. */
async function deleteObjects(store: ObjectStore, keys: readonly string[]): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < keys.length) {
      const key = keys[next++] as string;
      await store
        .delete(key)
        .catch((error: unknown) => console.error(`account deletion: object ${key} not deleted`, error));
    }
  };
  await Promise.all(Array.from({ length: Math.min(OBJECT_DELETE_CONCURRENCY, keys.length) }, worker));
}
