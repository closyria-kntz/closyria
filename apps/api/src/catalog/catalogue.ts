import { type Database, type SQL, schema, sql } from "@closyria/db";
import {
  type CatalogCard,
  type CatalogDetail,
  type CatalogPage,
  type CatalogQuery,
  type CatalogSort,
  catalogSortSchema,
  type ItemStage,
  type ReportReason,
  SIZE_KIND_BY_SLUG,
  type SizeKind,
} from "@closyria/shared";
import { z } from "zod";
import { type KeyType, validKeyValue } from "../wardrobe/item-view";
import { PROFILE_ORDER } from "../wardrobe/profiles";
import { catalogImageUrl } from "./product-view";

/** Articles per page of « Découvrir ». */
export const CATALOG_PAGE_SIZE = 24;
/** « Tu as déjà quelque chose de proche », « De la même boutique », « Dans le même style » (plan, global constraints). */
export const CATALOG_DETAIL_LIMITS = { close: 3, sameShop: 8, sameStyle: 8 } as const;
/** « Aimé par N personnes » only from this many people. */
export const LIKES_THRESHOLD = 3;
/** `isNew`: first seen by Closyria less than this many days ago. */
export const NEW_DAYS = 7;
/** « Dans le même style »: a price within this share of the article's counts as close. */
const NEAR_PRICE_RATIO = 0.2;
/** Search words kept from `q` (the rest is ignored). */
const MAX_SEARCH_TERMS = 8;

/** Thrown for a cursor that was not produced by `listCatalog` for the same sort. */
export class InvalidCatalogCursorError extends Error {}

/** Who is looking, and with which sizes (« Mes tailles » of the chosen profile, else of her first one). */
export type Viewer = {
  userId: string;
  profileId: string | null;
  sizes: Record<SizeKind, string | null>;
};

/**
 * The viewer: `profileId` when it is one of her profiles, else her first profile (never created here), else none.
 * Another person's profile is never read.
 */
export async function loadViewer(db: Database, userId: string, profileId: string | undefined): Promise<Viewer> {
  const columns = {
    id: schema.profiles.id,
    sizeTop: schema.profiles.sizeTop,
    sizeBottom: schema.profiles.sizeBottom,
    sizeShoes: schema.profiles.sizeShoes,
  };
  const own = profileId
    ? await db
        .select(columns)
        .from(schema.profiles)
        .where(sql`${schema.profiles.id} = ${profileId} and ${schema.profiles.userId} = ${userId}`)
    : [];
  const [profile] = own.length
    ? own
    : await db
        .select(columns)
        .from(schema.profiles)
        .where(sql`${schema.profiles.userId} = ${userId}`)
        .orderBy(...PROFILE_ORDER)
        .limit(1);
  return {
    userId,
    profileId: profile?.id ?? null,
    sizes: {
      top: profile?.sizeTop ?? null,
      bottom: profile?.sizeBottom ?? null,
      shoes: profile?.sizeShoes ?? null,
    },
  };
}

// --- SQL building blocks. The product is `p`, its shop `s`, its category `c`, its first photo `img`. ---

/** Size labels compared without case or spaces (as `sizeMatches`). */
const squash = (expr: SQL) => sql`nullif(lower(regexp_replace(${expr}, '\\s', '', 'g')), '')`;

const SLUGS_BY_KIND = Object.entries(SIZE_KIND_BY_SLUG).reduce<Record<SizeKind, string[]>>(
  (acc, [slug, kind]) => {
    acc[kind].push(slug);
    return acc;
  },
  { top: [], bottom: [], shoes: [] },
);

/**
 * Her size for the product's kind of article, squashed; null when the kind has none (accessories, unfiled) or she
 * gave none for it.
 */
function sizeOfKind(viewer: Viewer): SQL {
  const branches = (Object.keys(SLUGS_BY_KIND) as SizeKind[])
    .filter((kind) => viewer.sizes[kind] !== null)
    .map(
      (kind) =>
        sql`when c.slug in (${sql.join(
          SLUGS_BY_KIND[kind].map((slug) => sql`${slug}`),
          sql`, `,
        )}) then ${squash(sql`${viewer.sizes[kind]}::text`)}`,
    );
  return branches.length ? sql`(case ${sql.join(branches, sql` `)} end)` : sql`null::text`;
}

/** `sizeInStock`: null without a size for that kind, else whether her size is available. */
function sizeInStock(viewer: Viewer): SQL {
  const size = sizeOfKind(viewer);
  return sql`(case when ${size} is null then null else exists (
    select 1 from product_sizes ps
    where ps.product_id = p.id and ps.available and ${squash(sql`ps.label`)} = ${size}
  ) end)`;
}

const wanted = (viewer: Viewer) =>
  sql`exists (select 1 from items wi where wi.product_id = p.id and wi.user_id = ${viewer.userId} and wi.deleted_at is null)`;

/** Everyone's items on the product, out of the trash: one per person at most (unique index). */
const likesOf = sql`(select count(*)::int from items li where li.product_id = p.id and li.deleted_at is null)`;

/** Visibility of a catalogue article (plan, global constraints); the photo comes from the `img` join. */
const visible = sql`s.status = 'published' and s.merged_into_id is null
  and p.hidden_at is null and p.removed_at is null`;

/** A card needs a name, a price and its currency (and a photo: the inner `img` join). */
const complete = sql`p.name is not null and p.price_cents is not null and p.currency is not null`;

const onSale = sql`p.compare_at_cents > p.price_cents`;

type CardRow = {
  id: string;
  name: string;
  shop_id: string;
  shop_name: string;
  image_id: string;
  price_cents: number;
  compare_at_cents: number | null;
  currency: string;
  size_in_stock: boolean | null;
  wanted: boolean;
  [key: string]: unknown;
};

const toCard = (r: CardRow): CatalogCard => ({
  productId: r.id,
  name: r.name,
  shop: { id: r.shop_id, name: r.shop_name },
  imageUrl: catalogImageUrl(r.image_id),
  priceCents: Number(r.price_cents),
  // The shop's crossed price only when it is above the price (the item card's « −20 € » rule, `priceDropCents`).
  previousPriceCents:
    r.compare_at_cents !== null && Number(r.compare_at_cents) > Number(r.price_cents)
      ? Number(r.compare_at_cents)
      : null,
  currency: r.currency,
  sizeInStock: r.size_in_stock,
  wanted: r.wanted,
});

/** Cards of the products matching `where`, in `orderBy`; `visibleOnly` false only for her own pieces (« proche »). */
async function selectCards(
  db: Database,
  viewer: Viewer,
  options: { where: SQL[]; orderBy: SQL; limit: number; visibleOnly?: boolean; join?: SQL; extra?: SQL },
): Promise<CardRow[]> {
  const where = [complete, ...(options.visibleOnly === false ? [] : [visible]), ...options.where];
  const { rows } = await db.execute<CardRow>(sql`
    select p.id, p.name, s.id as shop_id, s.name as shop_name, img.id as image_id, p.price_cents,
      p.compare_at_cents, p.currency, ${sizeInStock(viewer)} as size_in_stock, ${wanted(viewer)} as wanted
      ${options.extra ? sql`, ${options.extra}` : sql``}
    from products p
    join shops s on s.id = p.shop_id
    left join categories c on c.id = p.category_id
    join lateral (
      select pi.id from product_images pi where pi.product_id = p.id order by pi.position, pi.id limit 1
    ) img on true
    ${options.join ?? sql``}
    where ${sql.join(where, sql` and `)}
    order by ${options.orderBy}
    limit ${options.limit}`);
  return rows;
}

// --- The catalogue list. ---

type SortKey = { expr: SQL; type: KeyType };
const idKey: SortKey = { expr: sql`p.id`, type: "uuid" };
const createdKey: SortKey = { expr: sql`p.created_at`, type: "timestamptz" };
const priceKey: SortKey = { expr: sql`p.price_cents`, type: "integer" };

/** Keyset of each sort: every key is non-null on a visible article and they all go one way. */
const SORTS: Record<CatalogSort, { keys: SortKey[]; desc: boolean }> = {
  new: { keys: [createdKey, idKey], desc: true },
  price_asc: { keys: [priceKey, idKey], desc: false },
  price_desc: { keys: [priceKey, idKey], desc: true },
  /** The most liked first, then the newest. */
  popular: { keys: [{ expr: likesOf, type: "integer" }, createdKey, idKey], desc: true },
};

const cursorSchema = z.object({ s: catalogSortSchema, k: z.array(z.string()).min(2).max(3) });

function encodeCursor(sort: CatalogSort, keys: string[]): string {
  return Buffer.from(JSON.stringify({ s: sort, k: keys })).toString("base64url");
}

function decodeCursor(sort: CatalogSort, cursor: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new InvalidCatalogCursorError();
  }
  const result = cursorSchema.safeParse(parsed);
  const keys = SORTS[sort].keys;
  if (!result.success || result.data.s !== sort || result.data.k.length !== keys.length) {
    throw new InvalidCatalogCursorError();
  }
  const values = result.data.k;
  if (!keys.every((key, i) => validKeyValue(key.type, values[i] ?? ""))) throw new InvalidCatalogCursorError();
  return values;
}

/**
 * The words of a search, lowercased, without accents and punctuation, the way `catalog_fold` and the `simple`
 * text search configuration see the stored text. One-letter words are dropped when there are longer ones.
 */
export function searchTerms(q: string): string[] {
  const words = q
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const long = words.filter((w) => w.length > 1);
  return [...new Set(long.length ? long : words)].slice(0, MAX_SEARCH_TERMS);
}

const folded = (expr: SQL) => sql`to_tsvector('simple'::regconfig, catalog_fold(${expr}))`;

/**
 * One search word: a prefix of a word of the product's name or brand (served by `products_search_idx`), of its
 * shop's name, or of its category's or color's name and keywords. Shops, categories and colors are small tables:
 * their matching ids are computed once per query.
 */
function termMatches(term: string): SQL {
  const query = sql`to_tsquery('simple'::regconfig, ${`${term}:*`})`;
  const words = sql`coalesce(name, '') || ' ' || array_to_string(keywords, ' ')`;
  return sql`(${schema.productSearchDocument("p")} @@ ${query}
    or p.shop_id = any(array(select id from shops where ${folded(sql`name`)} @@ ${query}))
    or p.category_id = any(array(select id from categories where ${folded(words)} @@ ${query}))
    or p.color_id = any(array(select id from colors where ${folded(words)} @@ ${query})))`;
}

function filters(query: CatalogQuery, viewer: Viewer, now: Date): SQL[] {
  const where: SQL[] = [];
  if (query.q) for (const term of searchTerms(query.q)) where.push(termMatches(term));
  if (query.category) {
    // The category and everything under it (« Robes » holds « Robe courte »).
    where.push(sql`p.category_id in (
      with recursive tree(id) as (
        select ${query.category}::uuid
        union all select child.id from categories child join tree on child.parent_id = tree.id
      ) select id from tree)`);
  }
  if (query.color) where.push(sql`p.color_id = ${query.color}`);
  if (query.priceMin !== undefined) where.push(sql`p.price_cents >= ${query.priceMin}`);
  if (query.priceMax !== undefined) where.push(sql`p.price_cents <= ${query.priceMax}`);
  if (query.shop) where.push(sql`p.shop_id = ${query.shop}`);
  if (query.values?.length) {
    where.push(
      sql`s.values @> array[${sql.join(
        query.values.map((v) => sql`${v}`),
        sql`, `,
      )}]::text[]`,
    );
  }
  if (query.onSale) where.push(onSale);
  if (query.isNew) where.push(sql`p.created_at >= ${new Date(now.getTime() - NEW_DAYS * 86_400_000).toISOString()}`);
  // Only the articles known not to be in her size are left out: no kind of size (bags) or no size of hers keeps them.
  if (query.mySize) where.push(sql`${sizeInStock(viewer)} is distinct from false`);
  return where;
}

/** One page of the catalogue (24). Throws `InvalidCatalogCursorError` for a foreign or malformed cursor. */
export async function listCatalog(db: Database, viewer: Viewer, query: CatalogQuery, now: Date): Promise<CatalogPage> {
  const { keys, desc } = SORTS[query.sort];
  const where = filters(query, viewer, now);
  if (query.cursor) {
    const values = decodeCursor(query.sort, query.cursor);
    const left = sql.join(
      keys.map((k) => k.expr),
      sql`, `,
    );
    const right = sql.join(
      keys.map((k, i) => sql`cast(${values[i]} as ${sql.raw(k.type)})`),
      sql`, `,
    );
    where.push(desc ? sql`(${left}) < (${right})` : sql`(${left}) > (${right})`);
  }
  const rows = await selectCards(db, viewer, {
    where,
    orderBy: sql.join(
      keys.map((k) => (desc ? sql`${k.expr} desc` : sql`${k.expr} asc`)),
      sql`, `,
    ),
    limit: CATALOG_PAGE_SIZE + 1,
    extra: sql.join(
      keys.map((k, i) => sql`(${k.expr})::text as ${sql.raw(`k${i}`)}`),
      sql`, `,
    ),
  });
  const page = rows.slice(0, CATALOG_PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map(toCard),
    nextCursor:
      rows.length > CATALOG_PAGE_SIZE && last
        ? encodeCursor(
            query.sort,
            keys.map((_, i) => String(last[`k${i}`])),
          )
        : null,
  };
}

// --- The sheet. ---

/** The sheet of a visible article, or null (404) when it is not visible or unknown. */
export async function loadCatalogDetail(
  db: Database,
  viewer: Viewer,
  productId: string,
): Promise<CatalogDetail | null> {
  const [row] = await selectCards(db, viewer, {
    where: [sql`p.id = ${productId}`],
    orderBy: sql`p.id`,
    limit: 1,
    extra: sql`p.category_id, p.color_id, p.shop_id as own_shop_id, ${likesOf} as likes`,
  });
  if (!row) return null;
  const categoryId = row.category_id as string | null;
  const colorId = row.color_id as string | null;
  const price = Number(row.price_cents);
  const newest = sql`p.created_at desc, p.id desc`;

  const [images, sizes, mine, close, sameShop, sameStyle] = await Promise.all([
    db
      .select({ id: schema.productImages.id })
      .from(schema.productImages)
      .where(sql`${schema.productImages.productId} = ${productId}`)
      .orderBy(schema.productImages.position, schema.productImages.id),
    db
      .select({ label: schema.productSizes.label, available: schema.productSizes.available })
      .from(schema.productSizes)
      .where(sql`${schema.productSizes.productId} = ${productId}`)
      .orderBy(schema.productSizes.position),
    db
      .select({ id: schema.items.id, stage: schema.items.stage })
      .from(schema.items)
      .where(
        sql`${schema.items.productId} = ${productId} and ${schema.items.userId} = ${viewer.userId} and ${schema.items.deletedAt} is null`,
      )
      .limit(1),
    // Her own owned pieces (« Reçu » and « Dans mon dressing ») of the same category and color, her corrections first;
    // shown whatever their catalogue visibility: they are hers.
    categoryId && colorId
      ? selectCards(db, viewer, {
          visibleOnly: false,
          join: sql`join items i on i.product_id = p.id`,
          where: [
            sql`i.user_id = ${viewer.userId} and i.deleted_at is null and i.stage = 'owned'`,
            ...(viewer.profileId ? [sql`i.profile_id = ${viewer.profileId}`] : []),
            sql`p.id <> ${productId}`,
            sql`coalesce(i.category_id, p.category_id) = ${categoryId}`,
            sql`coalesce(i.color_id, p.color_id) = ${colorId}`,
          ],
          orderBy: sql`i.created_at desc, i.id desc`,
          limit: CATALOG_DETAIL_LIMITS.close,
        })
      : [],
    selectCards(db, viewer, {
      where: [sql`p.shop_id = ${row.own_shop_id as string}`, sql`p.id <> ${productId}`],
      orderBy: newest,
      limit: CATALOG_DETAIL_LIMITS.sameShop,
    }),
    // Other shops: same category (weighs most), same color, or a price within 20 %.
    (() => {
      const sameCategory = categoryId ? sql`(p.category_id = ${categoryId})` : sql`false`;
      const sameColor = colorId ? sql`(p.color_id = ${colorId})` : sql`false`;
      const nearPrice = sql`(p.price_cents between ${Math.floor(price * (1 - NEAR_PRICE_RATIO))} and ${Math.ceil(
        price * (1 + NEAR_PRICE_RATIO),
      )})`;
      return selectCards(db, viewer, {
        where: [sql`p.shop_id <> ${row.own_shop_id as string}`, sql`(${sameCategory} or ${sameColor} or ${nearPrice})`],
        orderBy: sql`(4 * ${sameCategory}::int + 2 * ${sameColor}::int + ${nearPrice}::int) desc, ${newest}`,
        limit: CATALOG_DETAIL_LIMITS.sameStyle,
      });
    })(),
  ]);

  const likes = Number(row.likes);
  const own = mine[0];
  return {
    ...toCard(row),
    images: images.map((i) => catalogImageUrl(i.id)),
    sizes,
    likes: likes >= LIKES_THRESHOLD ? likes : null,
    myItem: own ? { itemId: own.id, stage: own.stage as ItemStage } : null,
    close: close.map(toCard),
    sameShop: sameShop.map(toCard),
    sameStyle: sameStyle.map(toCard),
  };
}

// --- Reports. ---

/** Records her report once (a second one changes nothing); false when the article is not visible or unknown. */
export async function reportProduct(
  db: Database,
  userId: string,
  productId: string,
  reason: ReportReason,
): Promise<boolean> {
  const { rows } = await db.execute<{ id: string }>(sql`
    select p.id from products p join shops s on s.id = p.shop_id
    where p.id = ${productId} and ${visible}
      and exists (select 1 from product_images pi where pi.product_id = p.id) and ${complete}`);
  if (rows.length === 0) return false;
  await db
    .insert(schema.productReports)
    .values({ productId, userId, reason })
    .onConflictDoNothing({ target: [schema.productReports.productId, schema.productReports.userId] });
  return true;
}
