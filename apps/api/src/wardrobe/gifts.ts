import { and, asc, type Database, eq, inArray, isNotNull, isNull, schema, sql } from "@closyria/db";
import { type GiftDelete, type GiftInput, type GiftRole, opinionNameKey, type SharedGiftState } from "@closyria/shared";
import type { Tx } from "./events";
import { ensureFriendDevice, hashDeviceKey, isFriendDevice, lockFriendName } from "./friend-device";

export type GiveResult =
  | { ok: true; role: GiftRole; raced: string | null }
  | { ok: false; error: "not_found" | "gifts_closed" | "name_taken" | "owner_took" };

export type LeaveResult = { ok: true } | { ok: false; error: "not_found" | "forbidden" };

type GiftTarget = { wishlistId: string; shareTokenHash: string; itemId: string };

/** Serialises every gift change on one item of one list (who reserves is decided under it). */
async function lockGiftItem(tx: Tx, wishlistId: string, itemId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`gift:${wishlistId}:${itemId}`}, 0))`);
}

/** The shared list, locked until commit so stopping the share waits for us (or we find it gone). */
async function lockSharedList(tx: Tx, wishlistId: string, shareTokenHash: string) {
  const [list] = await tx
    .select({ allowGifts: schema.wishlists.allowGifts })
    .from(schema.wishlists)
    .where(and(eq(schema.wishlists.id, wishlistId), eq(schema.wishlists.shareTokenHash, shareTokenHash)))
    .for("share");
  return list;
}

/**
 * A friend offers an item: she reserves it when nobody has, she contributes otherwise. `raced` names the friend
 * who reserved it first (when she becomes a contributor), so the page can say « {nom} vient de le réserver » if it
 * offered « Je lui offre ». Already a giver: her role, unchanged. Locks: the name (one person per name, shared with
 * opinions), then the item (who reserves), always in that order.
 */
export async function giveGift(db: Database, input: GiftInput & GiftTarget): Promise<GiveResult> {
  const nameKey = opinionNameKey(input.name);
  return db.transaction(async (tx): Promise<GiveResult> => {
    await lockFriendName(tx, input.wishlistId, nameKey);
    await lockGiftItem(tx, input.wishlistId, input.itemId);
    const list = await lockSharedList(tx, input.wishlistId, input.shareTokenHash);
    if (!list) return { ok: false, error: "not_found" };
    if (!list.allowGifts) return { ok: false, error: "gifts_closed" };
    // The item must be on the list, out of the trash and not given already; taking it out waits for us.
    const [member] = await tx
      .select({ stage: schema.items.stage, giftFrom: schema.items.giftFrom })
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
    if (!member || isGiven(member)) return { ok: false, error: "not_found" };
    const deviceKeyHash = hashDeviceKey(input.deviceKey);
    if ((await ensureFriendDevice(tx, input.wishlistId, nameKey, deviceKeyHash, input.claim)) === "name_taken")
      return { ok: false, error: "name_taken" };
    const rows = await tx
      .select({
        role: schema.wishlistGifts.role,
        giverName: schema.wishlistGifts.giverName,
        giverNameKey: schema.wishlistGifts.giverNameKey,
        ownerTookAt: schema.wishlistGifts.ownerTookAt,
      })
      .from(schema.wishlistGifts)
      .where(and(eq(schema.wishlistGifts.wishlistId, input.wishlistId), eq(schema.wishlistGifts.itemId, input.itemId)));
    const mine = rows.find((r) => r.giverNameKey === nameKey);
    if (mine) return { ok: true, role: mine.role as GiftRole, raced: null };
    if (rows.some((r) => r.ownerTookAt !== null)) return { ok: false, error: "owner_took" };
    const giver = { wishlistId: input.wishlistId, itemId: input.itemId, giverName: input.name, giverNameKey: nameKey };
    const reserved = await tx
      .insert(schema.wishlistGifts)
      .values({ ...giver, role: "reserver" })
      .onConflictDoNothing({
        target: [schema.wishlistGifts.wishlistId, schema.wishlistGifts.itemId],
        where: sql`${schema.wishlistGifts.role} = 'reserver'`,
      })
      .returning({ id: schema.wishlistGifts.id });
    if (reserved.length > 0) return { ok: true, role: "reserver", raced: null };
    await tx.insert(schema.wishlistGifts).values({ ...giver, role: "contributor" });
    const [reserver] = await tx
      .select({ name: schema.wishlistGifts.giverName })
      .from(schema.wishlistGifts)
      .where(
        and(
          eq(schema.wishlistGifts.wishlistId, input.wishlistId),
          eq(schema.wishlistGifts.itemId, input.itemId),
          eq(schema.wishlistGifts.role, "reserver"),
        ),
      );
    return { ok: true, role: "contributor", raced: reserver?.name ?? null };
  });
}

/**
 * A friend takes back her gift, with the device attached to her name. When the reserver leaves, the oldest
 * contributor reserves; with nobody left the item is free again. Works on items taken off the list too.
 */
export async function leaveGift(db: Database, input: GiftDelete & GiftTarget): Promise<LeaveResult> {
  const nameKey = opinionNameKey(input.name);
  return db.transaction(async (tx): Promise<LeaveResult> => {
    await lockFriendName(tx, input.wishlistId, nameKey);
    await lockGiftItem(tx, input.wishlistId, input.itemId);
    if (!(await lockSharedList(tx, input.wishlistId, input.shareTokenHash))) return { ok: false, error: "not_found" };
    if (!(await isFriendDevice(tx, input.wishlistId, nameKey, input.deviceKey)))
      return { ok: false, error: "forbidden" };
    const [left] = await tx
      .delete(schema.wishlistGifts)
      .where(
        and(
          eq(schema.wishlistGifts.wishlistId, input.wishlistId),
          eq(schema.wishlistGifts.itemId, input.itemId),
          eq(schema.wishlistGifts.giverNameKey, nameKey),
        ),
      )
      .returning({ role: schema.wishlistGifts.role });
    if (left?.role === "reserver") {
      const [next] = await tx
        .select({ id: schema.wishlistGifts.id })
        .from(schema.wishlistGifts)
        .where(
          and(eq(schema.wishlistGifts.wishlistId, input.wishlistId), eq(schema.wishlistGifts.itemId, input.itemId)),
        )
        .orderBy(asc(schema.wishlistGifts.createdAt), asc(schema.wishlistGifts.id))
        .limit(1);
      if (next)
        await tx.update(schema.wishlistGifts).set({ role: "reserver" }).where(eq(schema.wishlistGifts.id, next.id));
    }
    return { ok: true };
  });
}

/** Received as a gift already: shown under « Déjà offerts », no longer offered. */
export const isGiven = (item: { stage: string; giftFrom: string | null }) =>
  item.stage === "owned" && item.giftFrom !== null;

/**
 * The gift state of each item of a list that has givers (free items are left out). `mine` is the role of one of
 * the device's names (null without a device). Items taken off the list show only to their givers (`removed`).
 */
export async function giftStatesForList(
  db: Database | Tx,
  wishlistId: string,
  deviceNameKeys: string[] | null,
): Promise<Map<string, SharedGiftState>> {
  const rows = await db
    .select()
    .from(schema.wishlistGifts)
    .where(eq(schema.wishlistGifts.wishlistId, wishlistId))
    .orderBy(asc(schema.wishlistGifts.createdAt), asc(schema.wishlistGifts.id));
  const byItem = new Map<string, (typeof rows)[number][]>();
  for (const row of rows) byItem.set(row.itemId, [...(byItem.get(row.itemId) ?? []), row]);
  const keys = new Set(deviceNameKeys ?? []);
  const states = new Map<string, SharedGiftState>();
  for (const [itemId, givers] of byItem) {
    const mine = (givers.find((g) => keys.has(g.giverNameKey))?.role ?? null) as GiftRole | null;
    // Reserver first, then contributors by age (a missing reserver cannot happen; the oldest stands in for it).
    const ordered = [...givers.filter((g) => g.role === "reserver"), ...givers.filter((g) => g.role !== "reserver")];
    const names = ordered.map((g) => g.giverName);
    if (givers.some((g) => g.itemRemovedAt !== null)) {
      if (mine) states.set(itemId, { state: "removed", mine });
    } else if (givers.some((g) => g.ownerTookAt !== null)) {
      states.set(itemId, { state: "owner_took", givers: names, mine });
    } else {
      states.set(itemId, { state: "reserved", reserver: names[0] ?? "", contributors: names.slice(1), mine });
    }
  }
  return states;
}

/** She took items off a list: their gifts stay (for « l'a retiré de sa liste ») until every giver leaves. */
export async function markGiftsRemoved(tx: Tx, wishlistId: string, itemIds: string[]) {
  if (itemIds.length === 0) return;
  await tx
    .update(schema.wishlistGifts)
    .set({ itemRemovedAt: sql`now()` })
    .where(
      and(
        eq(schema.wishlistGifts.wishlistId, wishlistId),
        inArray(schema.wishlistGifts.itemId, itemIds),
        isNull(schema.wishlistGifts.itemRemovedAt),
      ),
    );
}

/** She put items back on a list: their gifts are ordinary again. */
export async function clearGiftsRemoved(tx: Tx, wishlistId: string, itemIds: string[]) {
  if (itemIds.length === 0) return;
  await tx
    .update(schema.wishlistGifts)
    .set({ itemRemovedAt: null })
    .where(
      and(
        eq(schema.wishlistGifts.wishlistId, wishlistId),
        inArray(schema.wishlistGifts.itemId, itemIds),
        isNotNull(schema.wishlistGifts.itemRemovedAt),
      ),
    );
}
