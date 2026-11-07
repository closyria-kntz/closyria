import { and, asc, type Database, desc, eq, isNull, schema, sql } from "@closyria/db";
import {
  DEFAULT_LOVE_LEVEL,
  type ItemCreate,
  type ItemMove,
  type ItemPatch,
  type ItemStage,
  type ItemStageInput,
  type UndoPayload,
  type WardrobeErrorCode,
} from "@closyria/shared";
import { pgCode } from "../pg-code";
import { recordEvent, type Tx } from "./events";
import { mergeItemInto } from "./merge-items";
import { ensureDefaultProfile, findOwnProfile } from "./profiles";
import { type ItemFieldValues, setFieldsUndo } from "./undo";

export type Item = typeof schema.items.$inferSelect;

/** What an action did: the item to show, the ids it changed and how to undo it (ruling R4), or a stable error. */
export type ItemOutcome =
  | { itemId: string; itemIds: string[]; undo: UndoPayload | null; created?: boolean; previous?: Item }
  | { error: WardrobeErrorCode };

/** Which item column a stage's amount goes to. */
export const AMOUNT_COLUMN: Partial<Record<ItemStage, "pricePaidCents" | "salePriceCents">> = {
  ordered: "pricePaidCents",
  owned: "pricePaidCents",
  for_sale: "salePriceCents",
  sold: "salePriceCents",
};

/** Serializes the actions that could leave two active items for one product (creation, restoration). */
export async function lockProductOfUser(tx: Tx, userId: string, productId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`items:${userId}:${productId}`}, 0))`);
}

export async function lockOwnItem(tx: Tx, userId: string, itemId: string): Promise<Item | null> {
  const [row] = await tx
    .select()
    .from(schema.items)
    .where(and(eq(schema.items.id, itemId), eq(schema.items.userId, userId)))
    .for("update");
  return row ?? null;
}

/** Her active item for the product, row-locked (read fresh, after any change in flight on it has committed). */
async function lockActiveItemFor(tx: Tx, userId: string, productId: string): Promise<Item | null> {
  const [row] = await tx
    .select()
    .from(schema.items)
    .where(and(eq(schema.items.userId, userId), eq(schema.items.productId, productId), isNull(schema.items.deletedAt)))
    .for("update");
  return row ?? null;
}

/**
 * Keeps a product (a wish with its level, priority and opinion; into a list; or as ordered). One active item per
 * user and product (G2): when she already has one, it is returned as is (`created: false`, no undo), whatever the profile asked for.
 * Undo of a creation: send it to the trash (task 7 may turn it into a hard delete) and drop its history row.
 */
export async function createItem(db: Database, userId: string, input: ItemCreate, now: Date): Promise<ItemOutcome> {
  const profile = input.profileId
    ? await findOwnProfile(db, userId, input.profileId)
    : await ensureDefaultProfile(db, userId);
  if (!profile) return { error: "not_found" };
  const [product] = await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(eq(schema.products.id, input.productId));
  if (!product) return { error: "not_found" };
  if (input.action === "list" && input.wishlistId) {
    const [list] = await db
      .select({ id: schema.wishlists.id })
      .from(schema.wishlists)
      .where(and(eq(schema.wishlists.id, input.wishlistId), eq(schema.wishlists.userId, userId)));
    if (!list) return { error: "not_found" };
  }
  return db.transaction(async (tx): Promise<ItemOutcome> => {
    // Read again under a share lock: a profile or list deleted since the checks above answers 404, not 500.
    const [heldProfile] = await tx
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(and(eq(schema.profiles.id, profile.id), eq(schema.profiles.userId, userId)))
      .for("share");
    if (!heldProfile) return { error: "not_found" };
    if (input.action === "list" && input.wishlistId) {
      const [heldList] = await tx
        .select({ id: schema.wishlists.id })
        .from(schema.wishlists)
        .where(and(eq(schema.wishlists.id, input.wishlistId), eq(schema.wishlists.userId, userId)))
        .for("share");
      if (!heldList) return { error: "not_found" };
    }
    await lockProductOfUser(tx, userId, product.id);
    const existing = await lockActiveItemFor(tx, userId, product.id);
    if (existing) return { itemId: existing.id, itemIds: [existing.id], undo: null, created: false };
    const stage: ItemStage = input.action === "ordered" ? "ordered" : "spotted";
    const [item] = await tx
      .insert(schema.items)
      .values({
        userId,
        profileId: profile.id,
        productId: product.id,
        stage,
        // A wish has a level (2 J'aime unless given); a list or an order has none.
        loveLevel: input.action === "wish" ? (input.loveLevel ?? DEFAULT_LOVE_LEVEL) : null,
        priority: input.action === "wish" ? (input.priority ?? false) : false,
        why: input.action === "wish" ? (input.why ?? null) : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!item) throw new Error("item not inserted");
    const removeEventIds: string[] = [];
    if (stage === "ordered") removeEventIds.push(await recordEvent(tx, item, { type: "stage", stage, at: now }));
    if (input.action === "list" && input.wishlistId) {
      await tx.execute(sql`
        insert into ${schema.wishlistItems} (wishlist_id, item_id, position, added_at)
        values (${input.wishlistId}, ${item.id},
          (select coalesce(max(position) + 1, 0) from ${schema.wishlistItems} where wishlist_id = ${input.wishlistId}),
          ${now})`);
    }
    return {
      itemId: item.id,
      itemIds: [item.id],
      undo: { ops: [{ ids: [item.id], op: "delete" }], removeEventIds },
      created: true,
    };
  });
}

/**
 * Her own fields. The cover must be one of the item's photos; category and colour must exist. Undo: `setFields` with
 * the previous values of exactly the fields that changed (ruling R9).
 */
export async function patchItem(
  db: Database,
  userId: string,
  itemId: string,
  patch: ItemPatch,
  now: Date,
): Promise<ItemOutcome> {
  return db.transaction(async (tx): Promise<ItemOutcome> => {
    const item = await lockOwnItem(tx, userId, itemId);
    if (!item) return { error: "not_found" };
    if (item.deletedAt) return { error: "item_deleted" };
    if (patch.coverMediaId) {
      const [photo] = await tx
        .select({ id: schema.itemMedia.id })
        .from(schema.itemMedia)
        .where(and(eq(schema.itemMedia.itemId, item.id), eq(schema.itemMedia.mediaId, patch.coverMediaId)));
      if (!photo) return { error: "invalid_cover" };
    }
    if (patch.categoryId) {
      const [row] = await tx
        .select({ id: schema.categories.id })
        .from(schema.categories)
        .where(eq(schema.categories.id, patch.categoryId));
      if (!row) return { error: "invalid_category" };
    }
    if (patch.colorId) {
      const [row] = await tx
        .select({ id: schema.colors.id })
        .from(schema.colors)
        .where(eq(schema.colors.id, patch.colorId));
      if (!row) return { error: "invalid_color" };
    }
    // Only the fields whose value really changes: a patch with the current values changes nothing at all.
    const set = Object.fromEntries(
      Object.entries(patch).filter(([key, value]) => value !== undefined && value !== item[key as keyof Item]),
    );
    if (Object.keys(set).length === 0) return { itemId: item.id, itemIds: [], undo: null };
    await tx
      .update(schema.items)
      .set({ ...set, updatedAt: now })
      .where(eq(schema.items.id, item.id));
    return {
      itemId: item.id,
      itemIds: [item.id],
      undo: { ops: setFieldsUndo([item], set as ItemFieldValues), removeEventIds: [] },
    };
  });
}

/**
 * Moves the item to another stage (any other stage, never the same one) and writes the history row. The amount goes
 * to the paid price (`ordered`, `owned`) or the sale price (`for_sale`, `sold`); the channel to `sale_channel`
 * (sale stages only).
 * Undo: back to the previous stage (`at`: the date of its own history row, creation date when it has none; the replay
 * writes no row), the previous amounts and channel when the action changed them (ruling R9), and the new row deleted.
 */
export async function changeStage(
  db: Database,
  userId: string,
  itemId: string,
  input: ItemStageInput,
  now: Date,
): Promise<ItemOutcome> {
  return db.transaction(async (tx): Promise<ItemOutcome> => {
    const item = await lockOwnItem(tx, userId, itemId);
    if (!item) return { error: "not_found" };
    if (item.deletedAt) return { error: "item_deleted" };
    if (item.stage === input.stage) return { error: "same_stage" };
    const [previousEvent] = await tx
      .select({ at: schema.itemEvents.at })
      .from(schema.itemEvents)
      .where(
        and(
          eq(schema.itemEvents.itemId, item.id),
          eq(schema.itemEvents.type, "stage"),
          eq(schema.itemEvents.stage, item.stage),
        ),
      )
      .orderBy(desc(schema.itemEvents.at), desc(schema.itemEvents.createdAt))
      .limit(1);
    const values: ItemFieldValues = {};
    const column = AMOUNT_COLUMN[input.stage];
    if (column && input.amountCents !== undefined) values[column] = input.amountCents;
    if (input.channel !== undefined && (input.stage === "for_sale" || input.stage === "sold")) {
      values.saleChannel = input.channel;
    }
    await tx
      .update(schema.items)
      .set({ ...values, stage: input.stage, updatedAt: now })
      .where(eq(schema.items.id, item.id));
    const eventId = await recordEvent(tx, item, {
      type: "stage",
      stage: input.stage,
      at: new Date(input.at),
      amountCents: input.amountCents ?? null,
    });
    const previousAt = (previousEvent?.at ?? item.createdAt).toISOString();
    return {
      itemId: item.id,
      itemIds: [item.id],
      undo: {
        ops: [
          { ids: [item.id], op: "stage", stage: item.stage as ItemStage, at: previousAt },
          ...setFieldsUndo([item], values),
        ],
        removeEventIds: [eventId],
      },
      previous: item,
    };
  });
}

/**
 * Moves the item to another of her profiles, traced in the history (G7). Lock order as the batches: the target profile
 * (shared: a deletion in flight finishes first, then 404), then the item row. A foreign-key violation that would still
 * slip through answers 404, never 500.
 */
export async function moveItem(
  db: Database,
  userId: string,
  itemId: string,
  input: ItemMove,
  now: Date,
): Promise<ItemOutcome> {
  try {
    return await db.transaction((tx) => moveItemIn(tx, userId, itemId, input, now));
  } catch (error) {
    if (pgCode(error) === "23503") return { error: "not_found" };
    throw error;
  }
}

async function moveItemIn(tx: Tx, userId: string, itemId: string, input: ItemMove, now: Date): Promise<ItemOutcome> {
  const [target] = await tx
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(and(eq(schema.profiles.id, input.profileId), eq(schema.profiles.userId, userId)))
    .for("share");
  const item = await lockOwnItem(tx, userId, itemId);
  if (!item) return { error: "not_found" };
  if (!target) return { error: "not_found" };
  if (item.deletedAt) return { error: "item_deleted" };
  if (item.profileId === target.id) return { error: "same_profile" };
  await tx.update(schema.items).set({ profileId: target.id, updatedAt: now }).where(eq(schema.items.id, item.id));
  const eventId = await recordEvent(tx, item, {
    type: "profile",
    fromProfileId: item.profileId,
    toProfileId: target.id,
    at: now,
  });
  return {
    itemId: item.id,
    itemIds: [item.id],
    undo: { ops: [{ ids: [item.id], op: "move", profileId: item.profileId }], removeEventIds: [eventId] },
  };
}

/** Sends the item to the trash (kept 30 days). Undo: restore. */
export async function trashItem(db: Database, userId: string, itemId: string, now: Date): Promise<ItemOutcome> {
  return db.transaction(async (tx): Promise<ItemOutcome> => {
    const item = await lockOwnItem(tx, userId, itemId);
    if (!item) return { error: "not_found" };
    if (item.deletedAt) return { error: "item_deleted" };
    await tx.update(schema.items).set({ deletedAt: now, updatedAt: now }).where(eq(schema.items.id, item.id));
    return {
      itemId: item.id,
      itemIds: [item.id],
      undo: { ops: [{ ids: [item.id], op: "restore" }], removeEventIds: [] },
    };
  });
}

/**
 * Takes the item out of the trash. When she has kept the same product again meanwhile, the two are merged into the
 * active one (G2, spec §3) and that one is returned; a merge cannot be undone (`undo: null`). Otherwise undo = trash.
 */
export async function restoreItem(db: Database, userId: string, itemId: string, now: Date): Promise<ItemOutcome> {
  return db.transaction(async (tx): Promise<ItemOutcome> => {
    // An item's product never changes: it is read before any lock.
    const [peek] = await tx
      .select({ productId: schema.items.productId })
      .from(schema.items)
      .where(and(eq(schema.items.id, itemId), eq(schema.items.userId, userId)));
    if (!peek) return { error: "not_found" };
    if (!peek.productId) throw new Error("items without a product come with 2b");
    // Lock order, as the batches: the product lock (no new active item meanwhile), then the source and target rows
    // together by id, read fresh under their locks so that a change committed on the target meanwhile is merged,
    // never overwritten.
    await lockProductOfUser(tx, userId, peek.productId);
    const rows = await tx
      .select()
      .from(schema.items)
      .where(
        and(
          eq(schema.items.userId, userId),
          sql`(${eq(schema.items.id, itemId)} or (${eq(schema.items.productId, peek.productId)} and ${isNull(schema.items.deletedAt)}))`,
        ),
      )
      .orderBy(asc(schema.items.id))
      .for("update");
    const item = rows.find((row) => row.id === itemId);
    if (!item) return { error: "not_found" };
    if (!item.deletedAt) return { error: "item_not_deleted" };
    const active = rows.find((row) => row.id !== item.id && row.deletedAt === null);
    if (active) {
      await mergeItemInto(tx, item, active, now);
      return { itemId: active.id, itemIds: [active.id], undo: null };
    }
    await tx.update(schema.items).set({ deletedAt: null, updatedAt: now }).where(eq(schema.items.id, item.id));
    return {
      itemId: item.id,
      itemIds: [item.id],
      undo: { ops: [{ ids: [item.id], op: "delete" }], removeEventIds: [] },
    };
  });
}
