import { createHash } from "node:crypto";
import { and, asc, type Database, eq, isNull, schema, sql } from "@closyria/db";
import { type OpinionDelete, type OpinionInput, type OpinionView, opinionNameKey } from "@closyria/shared";

const hashDeviceKey = (deviceKey: string) => createHash("sha256").update(deviceKey).digest("hex");

type OpinionRow = typeof schema.wishlistOpinions.$inferSelect;

export function toOpinionView(row: OpinionRow, seenAt: Date | null): OpinionView {
  return {
    id: row.id,
    name: row.authorName,
    level: row.level,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isNew: seenAt === null || row.updatedAt > seenAt,
  };
}

/** Her friends' opinions of a list by item, oldest first. `isNew`: written or changed after `seenAt` (null: never seen). */
export async function opinionsByItem(
  db: Database,
  wishlistId: string,
  seenAt: Date | null,
): Promise<Map<string, OpinionView[]>> {
  const rows = await db
    .select()
    .from(schema.wishlistOpinions)
    .where(eq(schema.wishlistOpinions.wishlistId, wishlistId))
    .orderBy(asc(schema.wishlistOpinions.createdAt), asc(schema.wishlistOpinions.id));
  const byItem = new Map<string, OpinionView[]>();
  for (const row of rows) {
    const list = byItem.get(row.itemId) ?? [];
    list.push(toOpinionView(row, seenAt));
    byItem.set(row.itemId, list);
  }
  return byItem;
}

export type UpsertResult =
  | { ok: true; opinion: OpinionView }
  | { ok: false; error: "not_found" | "name_taken" | "opinions_closed" };

/**
 * Writes (or replaces) one friend's opinion. The first device to use a name owns it; another device gets
 * `name_taken` unless it claims the name. A per-(list, name) advisory lock serialises concurrent writers, so two
 * simultaneous requests both succeed and leave one row.
 */
export async function upsertOpinion(
  db: Database,
  input: OpinionInput & { wishlistId: string; shareTokenHash: string; itemId: string },
): Promise<UpsertResult> {
  const nameKey = opinionNameKey(input.name);
  const deviceKeyHash = hashDeviceKey(input.deviceKey);
  return db.transaction(async (tx): Promise<UpsertResult> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.wishlistId}:${nameKey}`}, 0))`);
    // Lock the list and the item's membership until we commit: stopping the share or taking the item out waits for
    // us (and then erases what we wrote), or we find them gone. Opinions cannot outlive either.
    const [list] = await tx
      .select({ allowOpinions: schema.wishlists.allowOpinions })
      .from(schema.wishlists)
      .where(and(eq(schema.wishlists.id, input.wishlistId), eq(schema.wishlists.shareTokenHash, input.shareTokenHash)))
      .for("share");
    if (!list) return { ok: false, error: "not_found" };
    if (!list.allowOpinions) return { ok: false, error: "opinions_closed" };
    const [member] = await tx
      .select({ itemId: schema.wishlistItems.itemId })
      .from(schema.wishlistItems)
      .innerJoin(schema.items, eq(schema.items.id, schema.wishlistItems.itemId))
      .where(
        and(
          eq(schema.wishlistItems.wishlistId, input.wishlistId),
          eq(schema.wishlistItems.itemId, input.itemId),
          isNull(schema.items.deletedAt),
        ),
      )
      .for("share", { of: schema.wishlistItems });
    if (!member) return { ok: false, error: "not_found" };
    const devices = await tx
      .select({ hash: schema.wishlistOpinionDevices.deviceKeyHash })
      .from(schema.wishlistOpinionDevices)
      .where(
        and(
          eq(schema.wishlistOpinionDevices.wishlistId, input.wishlistId),
          eq(schema.wishlistOpinionDevices.authorNameKey, nameKey),
        ),
      );
    const known = devices.some((d) => d.hash === deviceKeyHash);
    if (devices.length > 0 && !known && !input.claim) return { ok: false, error: "name_taken" };
    if (!known) {
      await tx
        .insert(schema.wishlistOpinionDevices)
        .values({ wishlistId: input.wishlistId, authorNameKey: nameKey, deviceKeyHash })
        .onConflictDoNothing();
    }
    const [row] = await tx
      .insert(schema.wishlistOpinions)
      .values({
        wishlistId: input.wishlistId,
        itemId: input.itemId,
        authorName: input.name,
        authorNameKey: nameKey,
        level: input.level,
        note: input.note,
      })
      .onConflictDoUpdate({
        target: [
          schema.wishlistOpinions.wishlistId,
          schema.wishlistOpinions.itemId,
          schema.wishlistOpinions.authorNameKey,
        ],
        set: { authorName: input.name, level: input.level, note: input.note, updatedAt: sql`now()` },
      })
      .returning();
    if (!row) throw new Error("opinion not written");
    return { ok: true, opinion: { ...toOpinionView(row, new Date(0)), isNew: false } };
  });
}

/** Erases one opinion if the device belongs to the name; `forbidden` otherwise. Nothing to erase is fine. */
export async function deleteOpinion(
  db: Database,
  input: OpinionDelete & { wishlistId: string; itemId: string },
): Promise<"deleted" | "forbidden"> {
  const nameKey = opinionNameKey(input.name);
  const [device] = await db
    .select({ hash: schema.wishlistOpinionDevices.deviceKeyHash })
    .from(schema.wishlistOpinionDevices)
    .where(
      and(
        eq(schema.wishlistOpinionDevices.wishlistId, input.wishlistId),
        eq(schema.wishlistOpinionDevices.authorNameKey, nameKey),
        eq(schema.wishlistOpinionDevices.deviceKeyHash, hashDeviceKey(input.deviceKey)),
      ),
    );
  if (!device) return "forbidden";
  await db
    .delete(schema.wishlistOpinions)
    .where(
      and(
        eq(schema.wishlistOpinions.wishlistId, input.wishlistId),
        eq(schema.wishlistOpinions.itemId, input.itemId),
        eq(schema.wishlistOpinions.authorNameKey, nameKey),
      ),
    );
  return "deleted";
}
