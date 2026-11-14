import { type Database, eq, schema, sql } from "@closyria/db";
import type { ObjectStore } from "@closyria/storage";

/**
 * Deletes a person and everything she owns (RGPD, « Supprimer ce compte »). One transaction removes the `user` row;
 * every table holding her data has a foreign key to `user(id)` ON DELETE CASCADE (the owned tables registry checks it,
 * owned-tables.test.ts), so her rows go with it: wardrobe, photos, lists, alerts, events, sessions, sign-in methods.
 * Records that outlive her keep no link (audit log, capture log: ON DELETE SET NULL). Her pending sign-in codes go too.
 *
 * Her stored photos (`media`, and photo imports nobody attached yet) are deleted from object storage after the commit,
 * so a storage failure (logged, never thrown) cannot undo the deletion; it only leaves an orphan file behind.
 * Returns false when she does not exist.
 */
export async function deleteUserAccount(db: Database, store: ObjectStore, userId: string): Promise<boolean> {
  const keys = await db.transaction(async (tx) => {
    const [found] = await tx
      .select({ email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .for("update");
    if (!found) return null;
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
    return [...new Set([...media.map((m) => m.key), ...imports.flatMap((i) => (i.key ? [i.key] : []))])];
  });
  if (keys === null) return false;
  for (const key of keys) {
    await store
      .delete(key)
      .catch((error: unknown) => console.error(`account deletion: object ${key} not deleted`, error));
  }
  return true;
}
