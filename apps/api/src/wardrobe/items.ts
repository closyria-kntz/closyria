import { and, type Database, desc, eq, isNull, schema, sql } from "@closyria/db";
import type {
  ItemCreate,
  ItemMove,
  ItemPatch,
  ItemStage,
  ItemStageInput,
  UndoPayload,
  WardrobeErrorCode,
} from "@closyria/shared";
import { recordEvent, type Tx } from "./events";
import { mergeItemInto } from "./merge-items";
import { ensureDefaultProfile, findOwnProfile } from "./profiles";

export type Item = typeof schema.items.$inferSelect;

/** What an action did: the item to show, the ids it changed and how to undo it (ruling R4), or a stable error. */
export type ItemOutcome =
  | { itemId: string; itemIds: string[]; undo: UndoPayload | null; created?: boolean; previous?: Item }
  | { error: WardrobeErrorCode };

/** Which item column a stage's amount goes to. */
const AMOUNT_COLUMN: Partial<Record<ItemStage, "pricePaidCents" | "salePriceCents">> = {
  ordered: "pricePaidCents",
  owned: "pricePaidCents",
  for_sale: "salePriceCents",
  sold: "salePriceCents",
};

/** Serializes the actions that could leave two active items for one product (creation, restoration). */
async function lockProductOfUser(tx: Tx, userId: string, productId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`items:${userId}:${productId}`}, 0))`);
}

async function lockOwnItem(tx: Tx, userId: string, itemId: string): Promise<Item | null> {
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
 * Keeps a product (♡, into a list, or as ordered). One active item per user and product (G2): when she already has
 * one, it is returned as is (`created: false`, no undo), whatever the profile asked for.
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
        favorite: input.action === "favorite",
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
 * Her own fields. The cover must be one of the item's photos; category and colour must exist. Only a favorite toggle
 * is undoable (the bulk ops have no field edits): any other edit answers `undo: null`.
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
    const undo: UndoPayload | null =
      Object.keys(set).length === 1 && set.favorite !== undefined
        ? { ops: [{ ids: [item.id], op: "setFavorite", favorite: item.favorite }], removeEventIds: [] }
        : null;
    return { itemId: item.id, itemIds: [item.id], undo };
  });
}

/**
 * Moves the item to another stage (any other stage, never the same one) and writes the history row. The amount goes
 * to the paid price (`ordered`, `owned`) or the sale price (`for_sale`, `sold`); the channel to `sale_channel`
 * (sale stages only).
 * Undo: back to the previous stage at the date of its own history row (creation date when it has none), and the new
 * row deleted. The amounts written by the action are not reverted.
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
    const set: Partial<typeof schema.items.$inferInsert> = { stage: input.stage, updatedAt: now };
    const column = AMOUNT_COLUMN[input.stage];
    if (column && input.amountCents !== undefined) set[column] = input.amountCents;
    if (input.channel !== undefined && (input.stage === "for_sale" || input.stage === "sold")) {
      set.saleChannel = input.channel;
    }
    await tx.update(schema.items).set(set).where(eq(schema.items.id, item.id));
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
        ops: [{ ids: [item.id], op: "stage", stage: item.stage as ItemStage, at: previousAt }],
        removeEventIds: [eventId],
      },
      previous: item,
    };
  });
}

/** Moves the item to another of her profiles, traced in the history (G7). */
export async function moveItem(
  db: Database,
  userId: string,
  itemId: string,
  input: ItemMove,
  now: Date,
): Promise<ItemOutcome> {
  return db.transaction(async (tx): Promise<ItemOutcome> => {
    const item = await lockOwnItem(tx, userId, itemId);
    if (!item) return { error: "not_found" };
    const target = await findOwnProfile(tx, userId, input.profileId);
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
  });
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
    const item = await lockOwnItem(tx, userId, itemId);
    if (!item) return { error: "not_found" };
    if (!item.deletedAt) return { error: "item_not_deleted" };
    if (!item.productId) throw new Error("items without a product come with 2b");
    // Lock order: the source row, the product lock (no new active item meanwhile), then the target row, read fresh
    // under its lock so that a change committed on it in the meantime is merged, never overwritten.
    await lockProductOfUser(tx, userId, item.productId);
    const active = await lockActiveItemFor(tx, userId, item.productId);
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
