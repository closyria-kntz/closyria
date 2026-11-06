import { and, asc, type Database, eq, inArray, isNotNull, isNull, or, type SQL, schema, sql } from "@closyria/db";
import {
  ITEMS_PAGE_SIZE,
  type ItemListQuery,
  type ItemPage,
  type ItemPhotoView,
  type ItemSort,
  type ItemView,
  itemSortSchema,
  type TagView,
} from "@closyria/shared";
import { z } from "zod";
import { loadProductViews } from "../catalog/product-view";
import type { Tx } from "./events";

/** URL of one of her private photos (route of task 9, owner only). */
export const privateMediaUrl = (mediaId: string) => `/api/me/media/${mediaId}`;

/** Her items, in the order of `itemIds`, with their products, photos, tags and lists in a fixed number of queries. */
export async function loadItemViews(db: Database | Tx, userId: string, itemIds: string[]): Promise<ItemView[]> {
  if (itemIds.length === 0) return [];
  const rows = await db
    .select()
    .from(schema.items)
    .where(and(inArray(schema.items.id, itemIds), eq(schema.items.userId, userId)));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [products, photos, tags, lists] = await Promise.all([
    loadProductViews(
      db as Database,
      rows.flatMap((r) => (r.productId ? [r.productId] : [])),
    ),
    db
      .select({
        itemId: schema.itemMedia.itemId,
        id: schema.media.id,
        width: schema.media.width,
        height: schema.media.height,
      })
      .from(schema.itemMedia)
      .innerJoin(schema.media, eq(schema.media.id, schema.itemMedia.mediaId))
      .where(inArray(schema.itemMedia.itemId, ids))
      .orderBy(asc(schema.itemMedia.position), asc(schema.itemMedia.id)),
    db
      .select({ itemId: schema.itemTags.itemId, id: schema.tags.id, name: schema.tags.name, color: schema.tags.color })
      .from(schema.itemTags)
      .innerJoin(schema.tags, eq(schema.tags.id, schema.itemTags.tagId))
      .where(inArray(schema.itemTags.itemId, ids))
      .orderBy(asc(schema.tags.name)),
    db
      .select({ itemId: schema.wishlistItems.itemId, wishlistId: schema.wishlistItems.wishlistId })
      .from(schema.wishlistItems)
      .where(inArray(schema.wishlistItems.itemId, ids))
      .orderBy(asc(schema.wishlistItems.addedAt)),
  ]);
  const byId = new Map<string, ItemView>();
  for (const item of rows) {
    const product = item.productId ? products.get(item.productId) : undefined;
    if (!product) continue; // 2a: every item has a product (items born from a photo come with 2b)
    const own: ItemPhotoView[] = photos
      .filter((p) => p.itemId === item.id)
      .map((p) => ({ id: p.id, url: privateMediaUrl(p.id), width: p.width, height: p.height, source: "private" }));
    const shop: ItemPhotoView[] = product.images.map((i) => ({ ...i, source: "shop" }));
    byId.set(item.id, {
      id: item.id,
      profileId: item.profileId,
      product,
      stage: item.stage as ItemView["stage"],
      favorite: item.favorite,
      name: item.nameOverride ?? product.name,
      brand: item.brandOverride ?? product.brand,
      sizeLabel: item.sizeLabel,
      sizeNote: item.sizeNote,
      notes: item.notes,
      pricePaidCents: item.pricePaidCents,
      salePriceCents: item.salePriceCents,
      saleChannel: item.saleChannel,
      nameOverride: item.nameOverride,
      brandOverride: item.brandOverride,
      categoryId: item.categoryId,
      colorId: item.colorId,
      coverMediaId: item.coverMediaId,
      // Null cover = the shop's first photo, else her first private photo (spec §3).
      coverUrl: item.coverMediaId
        ? privateMediaUrl(item.coverMediaId)
        : (product.images[0]?.url ?? own[0]?.url ?? null),
      photos: [...own, ...shop],
      tags: tags
        .filter((t) => t.itemId === item.id)
        .map((t): TagView => ({ id: t.id, name: t.name, color: t.color as TagView["color"] })),
      wishlistIds: lists.filter((l) => l.itemId === item.id).map((l) => l.wishlistId),
      deletedAt: item.deletedAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    });
  }
  return itemIds.flatMap((id) => byId.get(id) ?? []);
}

/** One of her items (trashed ones included), or null when unknown or another user's. */
export async function loadItemView(db: Database | Tx, userId: string, itemId: string): Promise<ItemView | null> {
  return (await loadItemViews(db, userId, [itemId]))[0] ?? null;
}

/** Thrown for a cursor that was not produced by `listItems` for the same sort. */
export class InvalidCursorError extends Error {}

type KeyType = "timestamptz" | "integer" | "text" | "uuid";
type SortKey = { expr: SQL; type: KeyType };

/** Longest text key: a product name or a name override (300 characters). */
const MAX_TEXT_KEY = 300;
const INT_MAX = 2_147_483_647;
/** `timestamptz::text` in a UTC session, e.g. `2026-11-05 22:10:01.123456+00`. */
const TIMESTAMP_TEXT = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?\+00$/;
const uuidSchema = z.uuid();

/** Whether a cursor value can be cast to its key's type: a forged cursor must answer 400, never reach Postgres. */
function validKeyValue(type: KeyType, value: string): boolean {
  switch (type) {
    case "uuid":
      return uuidSchema.safeParse(value).success;
    case "integer":
      return /^-?\d{1,10}$/.test(value) && Math.abs(Number(value)) <= INT_MAX;
    case "text":
      return value.length <= MAX_TEXT_KEY;
    case "timestamptz": {
      const m = TIMESTAMP_TEXT.exec(value);
      if (!m) return false;
      const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number) as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day &&
        date.getUTCHours() === hour &&
        date.getUTCMinutes() === minute &&
        date.getUTCSeconds() === second
      );
    }
  }
}

const effectiveName = sql`coalesce(${schema.items.nameOverride}, ${schema.products.name})`;
const idKey: SortKey = { expr: sql`${schema.items.id}`, type: "uuid" };

/**
 * Keyset of each sort. Every key is non-null and all keys of a sort go the same way, so a row comparison
 * `(k1, k2, id) < (…)` gives the next page; unknown names and prices come last.
 */
type ListSort = ItemSort | "trash";

const SORTS: Record<ListSort, { keys: SortKey[]; desc: boolean }> = {
  /** Default of the trash view: latest deleted first. */
  trash: { keys: [{ expr: sql`${schema.items.deletedAt}`, type: "timestamptz" }, idKey], desc: true },
  recent: { keys: [{ expr: sql`${schema.items.createdAt}`, type: "timestamptz" }, idKey], desc: true },
  oldest: { keys: [{ expr: sql`${schema.items.createdAt}`, type: "timestamptz" }, idKey], desc: false },
  name: {
    keys: [
      { expr: sql`(${effectiveName} is null)::int`, type: "integer" },
      { expr: sql`lower(coalesce(${effectiveName}, ''))`, type: "text" },
      idKey,
    ],
    desc: false,
  },
  price_asc: {
    keys: [
      { expr: sql`(${schema.products.priceCents} is null)::int`, type: "integer" },
      { expr: sql`coalesce(${schema.products.priceCents}, 0)`, type: "integer" },
      idKey,
    ],
    desc: false,
  },
  price_desc: {
    keys: [
      { expr: sql`(${schema.products.priceCents} is not null)::int`, type: "integer" },
      { expr: sql`coalesce(${schema.products.priceCents}, 0)`, type: "integer" },
      idKey,
    ],
    desc: true,
  },
};

const cursorSchema = z.object({
  s: z.enum([...itemSortSchema.options, "trash"]),
  k: z.array(z.string()).min(2).max(3),
});

function encodeCursor(sort: ListSort, keys: string[]): string {
  return Buffer.from(JSON.stringify({ s: sort, k: keys })).toString("base64url");
}

function decodeCursor(sort: ListSort, cursor: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new InvalidCursorError();
  }
  const result = cursorSchema.safeParse(parsed);
  const keys = SORTS[sort].keys;
  if (!result.success || result.data.s !== sort || result.data.k.length !== keys.length) {
    throw new InvalidCursorError();
  }
  const values = result.data.k;
  if (!keys.every((key, i) => validKeyValue(key.type, values[i] ?? ""))) throw new InvalidCursorError();
  return values;
}

/**
 * One page (48) of her items, filtered and sorted, with a cursor on the sort keys: `(created_at, id)` descending by
 * default, `(deleted_at, id)` descending in the trash (`deleted=true`). Price sorts use the product's price.
 * Throws `InvalidCursorError` for a foreign or malformed cursor.
 */
export async function listItems(db: Database, userId: string, query: ItemListQuery): Promise<ItemPage> {
  const sort: ListSort = query.sort ?? (query.deleted ? "trash" : "recent");
  const { keys, desc } = SORTS[sort];
  const conditions: SQL[] = [
    eq(schema.items.userId, userId),
    query.deleted ? isNotNull(schema.items.deletedAt) : isNull(schema.items.deletedAt),
  ];
  if (query.stage) conditions.push(eq(schema.items.stage, query.stage));
  if (query.profile) conditions.push(eq(schema.items.profileId, query.profile));
  if (query.product) conditions.push(eq(schema.items.productId, query.product));
  if (query.favorite !== undefined) conditions.push(eq(schema.items.favorite, query.favorite));
  if (query.tag) {
    conditions.push(
      sql`exists (select 1 from ${schema.itemTags} where ${schema.itemTags.itemId} = ${schema.items.id} and ${schema.itemTags.tagId} = ${query.tag})`,
    );
  }
  if (query.shop) {
    // The filter menu sends the shop's id; a slug is still accepted (and a slug may look like a UUID).
    const byId = z.uuid().safeParse(query.shop).success;
    conditions.push(
      (byId
        ? or(eq(schema.shops.id, query.shop), eq(schema.shops.slug, query.shop))
        : eq(schema.shops.slug, query.shop)) as SQL,
    );
  }
  if (query.category) {
    conditions.push(sql`coalesce(${schema.items.categoryId}, ${schema.products.categoryId}) = ${query.category}`);
  }
  if (query.color) conditions.push(sql`coalesce(${schema.items.colorId}, ${schema.products.colorId}) = ${query.color}`);
  if (query.audience) conditions.push(eq(schema.products.audience, query.audience));
  if (query.cursor) {
    const values = decodeCursor(sort, query.cursor);
    const left = sql.join(
      keys.map((k) => k.expr),
      sql`, `,
    );
    const right = sql.join(
      keys.map((k, i) => sql`cast(${values[i]} as ${sql.raw(k.type)})`),
      sql`, `,
    );
    conditions.push(desc ? sql`(${left}) < (${right})` : sql`(${left}) > (${right})`);
  }
  const selection: Record<string, SQL.Aliased<string> | typeof schema.items.id> = { id: schema.items.id };
  keys.forEach((k, i) => {
    selection[`k${i}`] = sql<string>`(${k.expr})::text`.as(`k${i}`);
  });
  const rows = (await db
    .select(selection)
    .from(schema.items)
    .innerJoin(schema.products, eq(schema.products.id, schema.items.productId))
    .innerJoin(schema.shops, eq(schema.shops.id, schema.products.shopId))
    .where(and(...conditions))
    .orderBy(...keys.map((k) => (desc ? sql`${k.expr} desc` : sql`${k.expr} asc`)))
    .limit(ITEMS_PAGE_SIZE + 1)) as unknown as Record<string, string>[];
  const page = rows.slice(0, ITEMS_PAGE_SIZE);
  const last = page.at(-1);
  const nextCursor =
    rows.length > ITEMS_PAGE_SIZE && last
      ? encodeCursor(
          sort,
          keys.map((_, i) => String(last[`k${i}`])),
        )
      : null;
  const items = await loadItemViews(
    db,
    userId,
    page.map((r) => String(r.id)),
  );
  return { items, nextCursor };
}
