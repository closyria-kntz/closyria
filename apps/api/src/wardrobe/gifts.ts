import { and, asc, type Database, eq, inArray, isNotNull, isNull, schema, sql } from "@closyria/db";
import { type GiftDelete, type GiftInput, type GiftRole, opinionNameKey, type SharedGiftState } from "@closyria/shared";
import type { Tx } from "./events";
import { ensureFriendDevice, hashDeviceKey, isFriendDevice, lockFriendName } from "./friend-device";

export type GiveResult =
  | { ok: true; role: GiftRole }
  | { ok: false; error: "not_found" | "gifts_closed" | "name_taken" | "owner_took" }
  | { ok: false; error: "already_reserved"; reserver: string };

export type LeaveResult = { ok: true } | { ok: false; error: "not_found" | "forbidden" };

type GiftTarget = { wishlistId: string; shareTokenHash: string; itemId: string };

/** The gifts of an item on a list that are not over (a received row counts as absent everywhere). */
const activeGiftsOf = (wishlistId: string, itemId: string) =>
  and(
    eq(schema.wishlistGifts.wishlistId, wishlistId),
    eq(schema.wishlistGifts.itemId, itemId),
    isNull(schema.wishlistGifts.receivedAt),
  );

/** Serialises every gift change on one item of one list (who reserves is decided under it). */
async function lockGiftItem(tx: Tx, wishlistId: string, itemId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`gift:${wishlistId}:${itemId}`}, 0))`);
}

/** Several item locks, by id (a fixed order: no deadlock between two of her batches). */
async function lockGiftItems(tx: Tx, wishlistId: string, itemIds: string[]) {
  for (const itemId of [...new Set(itemIds)].sort()) await lockGiftItem(tx, wishlistId, itemId);
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
 * A friend offers an item. `reserve` (« Je lui offre »): she reserves it, or `already_reserved` names who did just
 * before (nothing written: the page says « {nom} vient de le réserver » and offers « Je participe »). `join`
 * (« Je participe »): she contributes, or reserves when nobody has. Already a giver: her role, unchanged. Locks:
 * the name (one person per name, shared with opinions), then the item (who reserves), always in that order.
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
    const rows = await tx
      .select({
        role: schema.wishlistGifts.role,
        giverName: schema.wishlistGifts.giverName,
        giverNameKey: schema.wishlistGifts.giverNameKey,
        ownerTookAt: schema.wishlistGifts.ownerTookAt,
      })
      .from(schema.wishlistGifts)
      .where(activeGiftsOf(input.wishlistId, input.itemId));
    const mine = rows.find((r) => r.giverNameKey === nameKey);
    const reserver = rows.find((r) => r.role === "reserver");
    // Refusals that write nothing come before the name check, which may attach the device.
    if (!mine && rows.some((r) => r.ownerTookAt !== null)) return { ok: false, error: "owner_took" };
    if (!mine && reserver && input.intent === "reserve")
      return { ok: false, error: "already_reserved", reserver: reserver.giverName };
    const deviceKeyHash = hashDeviceKey(input.deviceKey);
    if ((await ensureFriendDevice(tx, input.wishlistId, nameKey, deviceKeyHash, input.claim)) === "name_taken")
      return { ok: false, error: "name_taken" };
    if (mine) return { ok: true, role: mine.role as GiftRole };
    const role: GiftRole = reserver ? "contributor" : "reserver";
    // Under the item lock nobody else can reserve meanwhile; the partial unique index guards it all the same.
    await tx.insert(schema.wishlistGifts).values({
      wishlistId: input.wishlistId,
      itemId: input.itemId,
      giverName: input.name,
      giverNameKey: nameKey,
      role,
    });
    return { ok: true, role };
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
      .where(and(activeGiftsOf(input.wishlistId, input.itemId), eq(schema.wishlistGifts.giverNameKey, nameKey)))
      .returning({ role: schema.wishlistGifts.role });
    if (left?.role === "reserver") {
      const [next] = await tx
        .select({ id: schema.wishlistGifts.id })
        .from(schema.wishlistGifts)
        .where(activeGiftsOf(input.wishlistId, input.itemId))
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
    .where(and(eq(schema.wishlistGifts.wishlistId, wishlistId), isNull(schema.wishlistGifts.receivedAt)))
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

/**
 * She takes items off a list: their gifts stay (for « l'a retiré de sa liste ») until every giver leaves. Call it
 * before deleting the `wishlist_items` rows: a giver's transaction holds the item lock and then waits for that row,
 * so taking the lock after the delete would deadlock.
 */
export async function markGiftsRemoved(tx: Tx, wishlistId: string, itemIds: string[]) {
  if (itemIds.length === 0) return;
  await lockGiftItems(tx, wishlistId, itemIds);
  await tx
    .update(schema.wishlistGifts)
    .set({ itemRemovedAt: sql`now()` })
    .where(
      and(
        eq(schema.wishlistGifts.wishlistId, wishlistId),
        inArray(schema.wishlistGifts.itemId, itemIds),
        isNull(schema.wishlistGifts.itemRemovedAt),
        isNull(schema.wishlistGifts.receivedAt),
      ),
    );
}

/** She puts items back on a list: their gifts are ordinary again. Call it before inserting the rows (same reason). */
export async function clearGiftsRemoved(tx: Tx, wishlistId: string, itemIds: string[]) {
  if (itemIds.length === 0) return;
  await lockGiftItems(tx, wishlistId, itemIds);
  await tx
    .update(schema.wishlistGifts)
    .set({ itemRemovedAt: null })
    .where(
      and(
        eq(schema.wishlistGifts.wishlistId, wishlistId),
        inArray(schema.wishlistGifts.itemId, itemIds),
        isNotNull(schema.wishlistGifts.itemRemovedAt),
        isNull(schema.wishlistGifts.receivedAt),
      ),
    );
}

/** Her side: the item locks of every (list, item) pair, in one fixed order (no deadlock between two of her calls). */
async function lockGiftPairs(tx: Tx, pairs: { wishlistId: string; itemId: string }[]) {
  const keys = [...new Set(pairs.map((p) => `${p.wishlistId}:${p.itemId}`))].sort();
  for (const key of keys) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`gift:${key}`}, 0))`);
}

/** The (list, item) pairs that have gift rows, received ones included, for these items. */
async function giftPairsOf(tx: Tx, itemIds: string[]) {
  return tx
    .selectDistinct({ wishlistId: schema.wishlistGifts.wishlistId, itemId: schema.wishlistGifts.itemId })
    .from(schema.wishlistGifts)
    .where(inArray(schema.wishlistGifts.itemId, itemIds));
}

/**
 * `gift-check`: which of her items a friend has planned to give — an active gift, not taken by herself, on a list
 * of hers that is shared and open to gifts. Ids only, in the order asked: never who.
 */
export async function reservedItemIds(db: Database, userId: string, itemIds: string[]): Promise<string[]> {
  const rows = await db
    .selectDistinct({ itemId: schema.wishlistGifts.itemId })
    .from(schema.wishlistGifts)
    .innerJoin(schema.wishlists, eq(schema.wishlists.id, schema.wishlistGifts.wishlistId))
    .innerJoin(schema.items, eq(schema.items.id, schema.wishlistGifts.itemId))
    .where(
      and(
        inArray(schema.wishlistGifts.itemId, itemIds),
        eq(schema.wishlists.userId, userId),
        eq(schema.items.userId, userId),
        eq(schema.wishlists.allowGifts, true),
        isNotNull(schema.wishlists.shareTokenHash),
        isNull(schema.wishlistGifts.ownerTookAt),
        isNull(schema.wishlistGifts.itemRemovedAt),
        isNull(schema.wishlistGifts.receivedAt),
      ),
    );
  const reserved = new Set(rows.map((r) => r.itemId));
  return itemIds.filter((id) => reserved.has(id));
}

/**
 * « Je le prends quand même »: her friends' active gifts of these items (hers only) show « pris elle-même » on the
 * link, on every list. Under the item locks, so a friend giving at the same moment is refused or marked too.
 */
export async function markOwnerTook(db: Database, userId: string, itemIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    const own = tx.select({ id: schema.items.id }).from(schema.items).where(eq(schema.items.userId, userId));
    const scope = and(
      inArray(schema.wishlistGifts.itemId, itemIds),
      inArray(schema.wishlistGifts.itemId, own),
      isNull(schema.wishlistGifts.ownerTookAt),
      isNull(schema.wishlistGifts.receivedAt),
    );
    const pairs = await tx
      .selectDistinct({ wishlistId: schema.wishlistGifts.wishlistId, itemId: schema.wishlistGifts.itemId })
      .from(schema.wishlistGifts)
      .where(scope);
    if (pairs.length === 0) return;
    await lockGiftPairs(tx, pairs);
    await tx.update(schema.wishlistGifts).set({ ownerTookAt: sql`now()` }).where(scope);
  });
}

/** « Offert par … »: « Léa », « Léa et Inès », « Léa, Inès et Sarah »; null without anyone. */
export function joinGiverNames(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return names[0] ?? null;
  return `${names.slice(0, -1).join(", ")} et ${names.at(-1)}`;
}

/**
 * « Reçu en cadeau », gift side, on her item already locked: every active gift of the item, on all her lists, is
 * over (`received_at`); the givers' names come back, frozen for `gift_from`: reservers first, then contributors by
 * age, one name per person. Rows received earlier (an older « Reçu en cadeau » not undone) are deleted first, so
 * the received rows are only this one's, for its undo.
 */
export async function receiveGifts(tx: Tx, itemId: string): Promise<string | null> {
  const listed = await tx
    .select({ wishlistId: schema.wishlistItems.wishlistId, itemId: schema.wishlistItems.itemId })
    .from(schema.wishlistItems)
    .where(eq(schema.wishlistItems.itemId, itemId));
  await lockGiftPairs(tx, [...listed, ...(await giftPairsOf(tx, [itemId]))]);
  await tx
    .delete(schema.wishlistGifts)
    .where(and(eq(schema.wishlistGifts.itemId, itemId), isNotNull(schema.wishlistGifts.receivedAt)));
  const givers = await tx
    .update(schema.wishlistGifts)
    .set({ receivedAt: sql`now()` })
    .where(and(eq(schema.wishlistGifts.itemId, itemId), isNull(schema.wishlistGifts.receivedAt)))
    .returning({
      giverName: schema.wishlistGifts.giverName,
      giverNameKey: schema.wishlistGifts.giverNameKey,
      role: schema.wishlistGifts.role,
      createdAt: schema.wishlistGifts.createdAt,
      id: schema.wishlistGifts.id,
    });
  const byAge = givers.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const ordered = [...byAge.filter((g) => g.role === "reserver"), ...byAge.filter((g) => g.role !== "reserver")];
  const seen = new Set<string>();
  const names = ordered.flatMap((g) => {
    if (seen.has(g.giverNameKey)) return [];
    seen.add(g.giverNameKey);
    return [g.giverName];
  });
  return joinGiverNames(names);
}

/**
 * Undo of « Reçu en cadeau », gift side, on her items already locked: their received gifts are active again, with
 * their roles. A (list, item) that has active gifts meanwhile keeps them and its received rows stay over (they
 * would clash). Returns the items whose gifts came back.
 */
export async function unreceiveGifts(tx: Tx, itemIds: string[]): Promise<string[]> {
  const pairs = await giftPairsOf(tx, itemIds);
  if (pairs.length === 0) return [];
  await lockGiftPairs(tx, pairs);
  const back = await tx.execute<{ item_id: string }>(sql`
    update ${schema.wishlistGifts} g set received_at = null
    where ${inArray(sql`g.item_id`, itemIds)} and g.received_at is not null
      and not exists (
        select 1 from ${schema.wishlistGifts} a
        where a.wishlist_id = g.wishlist_id and a.item_id = g.item_id and a.received_at is null
      )
    returning g.item_id`);
  return [...new Set(back.rows.map((r) => r.item_id))];
}
