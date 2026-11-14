import { type Database, type SQL, schema, sql } from "@closyria/db";
import {
  type CatalogCard,
  type CatalogClosePiece,
  type CatalogDetail,
  type CatalogPage,
  type CatalogQuery,
  type CatalogSort,
  catalogSortSchema,
  factualDescription,
  type IllustrationKind,
  type ItemStage,
  illustrationKindsByCategory,
  type ReportReason,
  type SizeKind,
  sizeKindsByCategory,
  sizeTokensOf,
} from "@closyria/shared";
import { z } from "zod";
import { type KeyType, privateMediaUrl, validKeyValue } from "../wardrobe/item-view";
import { PROFILE_ORDER } from "../wardrobe/profiles";
import { catalogImageUrl } from "./product-view";

/** Articles per page of « Découvrir ». */
export const CATALOG_PAGE_SIZE = 24;
/** « Tu as déjà quelque chose de proche », « De la même boutique », « Dans le même style » (plan, global constraints). */
export const CATALOG_DETAIL_LIMITS = { close: 3, sameShop: 8, sameStyle: 8 } as const;
/** « Aimé par N personnes » only from this many people. */
export const LIKES_THRESHOLD = 3;
/** `isNew`: put online (`published_at`: the shop's date, first seen, or set by the admin) less than this many days ago. */
export const NEW_DAYS = 7;
/** « Dans le même style »: a price within this share of the article's counts as close. */
const NEAR_PRICE_RATIO = 0.2;
/** Search words kept from `q` (the rest is ignored). */
const MAX_SEARCH_TERMS = 8;

/** Thrown for a cursor that was not produced by `listCatalog` for the same sort. */
export class InvalidCatalogCursorError extends Error {}

/**
 * Who is looking, and with which sizes (« Mes tailles » of the chosen profile, else of her first one); `sizeKinds`
 * tells which of them applies to each category (`sizeKindsByCategory`: a sub-category inherits its parent's).
 */
export type Viewer = {
  userId: string;
  profileId: string | null;
  sizes: Record<SizeKind, string[]>;
  sizeKinds: ReadonlyMap<string, SizeKind>;
  /**
   * An admin or a « Testeuse » (catalogue conforme, 2026-11-14): she sees what only a full import brought, with every
   * shop's photos and texts. Everyone else sees pasted articles and partner shops (`visibleTo`, `showsShopMedia`).
   */
  privileged: boolean;
  /** The illustration's silhouette of each category (`illustrationKindsByCategory`); absent: « other ». */
  illustrationKinds: ReadonlyMap<string, IllustrationKind>;
  /** The category tree (slug, name, parent), for the factual sentence of a sheet. */
  categories: ReadonlyMap<string, { slug: string; name: string; parentId: string | null }>;
};

/** Whether the person is an admin or a « Testeuse » (`Viewer.privileged`); false for an unknown id. */
export async function isPrivileged(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ role: schema.user.role, isTester: schema.user.isTester })
    .from(schema.user)
    .where(sql`${schema.user.id} = ${userId}`);
  return row ? row.role === "admin" || row.isTester : false;
}

/**
 * The viewer: `profileId` when it is one of her profiles, else her first profile (never created here), else none.
 * Another person's profile is never read.
 */
export async function loadViewer(db: Database, userId: string, profileId: string | undefined): Promise<Viewer> {
  const columns = {
    id: schema.profiles.id,
    sizesTop: schema.profiles.sizesTop,
    sizesBottom: schema.profiles.sizesBottom,
    sizesShoes: schema.profiles.sizesShoes,
  };
  const own = profileId
    ? await db
        .select(columns)
        .from(schema.profiles)
        .where(sql`${schema.profiles.id} = ${profileId} and ${schema.profiles.userId} = ${userId}`)
    : [];
  const [[profile], categories, privileged] = await Promise.all([
    own.length
      ? own
      : db
          .select(columns)
          .from(schema.profiles)
          .where(sql`${schema.profiles.userId} = ${userId}`)
          .orderBy(...PROFILE_ORDER)
          .limit(1),
    // A small reference table, read once per request.
    db
      .select({
        id: schema.categories.id,
        parentId: schema.categories.parentId,
        slug: schema.categories.slug,
        name: schema.categories.name,
      })
      .from(schema.categories),
    isPrivileged(db, userId),
  ]);
  return {
    userId,
    profileId: profile?.id ?? null,
    sizes: {
      top: profile?.sizesTop ?? [],
      bottom: profile?.sizesBottom ?? [],
      shoes: profile?.sizesShoes ?? [],
    },
    sizeKinds: sizeKindsByCategory(categories),
    privileged,
    illustrationKinds: illustrationKindsByCategory(categories),
    categories: new Map(categories.map((c) => [c.id, { slug: c.slug, name: c.name, parentId: c.parentId }])),
  };
}

// --- SQL building blocks. The product is `p`, its shop `s`, its first photo `img`. ---

/** Whether she gave any size at all (« Mes tailles »): without one, « Ma taille en stock » cannot filter. */
export const hasSizes = (viewer: Viewer) => Object.values(viewer.sizes).some((sizes) => sizeTokensOf(sizes).length > 0);

const textArray = (values: string[]) =>
  sql`array[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;

/**
 * Whether one of her sizes for the product's kind of article (`viewer.sizeKinds`) is available, with the label
 * matching of `sizeMatches` (`catalog_size_tokens`, migration 0025); null when the kind has none (accessories,
 * unfiled) or she gave none for it.
 */
function kindInStock(viewer: Viewer): SQL {
  const idsByKind: Record<SizeKind, string[]> = { top: [], bottom: [], shoes: [] };
  for (const [categoryId, kind] of viewer.sizeKinds) idsByKind[kind].push(categoryId);
  const branches = (Object.keys(idsByKind) as SizeKind[]).flatMap((kind) => {
    const tokens = sizeTokensOf(viewer.sizes[kind]);
    if (tokens.length === 0 || idsByKind[kind].length === 0) return [];
    return [
      sql`when p.category_id in (${sql.join(
        idsByKind[kind].map((id) => sql`${id}::uuid`),
        sql`, `,
      )}) then exists (
        select 1 from product_sizes ps
        where ps.product_id = p.id and ps.available and catalog_size_tokens(ps.label) && ${textArray(tokens)}
      )`,
    ];
  });
  return branches.length ? sql`(case ${sql.join(branches, sql` `)} end)` : sql`null::boolean`;
}

/** Its only available size is « taille unique » (TU, One size…). */
const oneSizeOnly = sql`(exists (select 1 from product_sizes ps where ps.product_id = p.id and ps.available)
  and not exists (
    select 1 from product_sizes ps
    where ps.product_id = p.id and ps.available and not catalog_is_one_size(ps.label)
  ))`;

/**
 * `sizeInStock` (« Ta taille en stock », and the strict « Ma taille en stock » filter: `is true`): null when she has
 * no size at all; true for an article of a sized kind (haut, bas, chaussures) in « taille unique » only; else whether
 * one of her sizes for its kind is available, null when its kind takes none of hers (accessories and unfiled
 * articles, even in « taille unique »; a kind she left empty).
 */
function sizeInStock(viewer: Viewer): SQL {
  if (!hasSizes(viewer)) return sql`null::boolean`;
  const sized = [...viewer.sizeKinds.keys()];
  if (sized.length === 0) return kindInStock(viewer);
  const sizedKind = sql`p.category_id in (${sql.join(
    sized.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
  return sql`(case when ${sizedKind} and ${oneSizeOnly} then true else ${kindInStock(viewer)} end)`;
}

const wanted = (viewer: Viewer) =>
  sql`exists (select 1 from items wi where wi.product_id = p.id and wi.user_id = ${viewer.userId} and wi.deleted_at is null)`;

/** Everyone's items on the product, out of the trash: one per person at most (unique index). */
const likesOf = sql`(select count(*)::int from items li where li.product_id = p.id and li.deleted_at is null)`;

/**
 * A shop of « Découvrir »: published, not merged into another, not a « grande enseigne » (its articles stay usable in
 * wishes, lists and links, never shown here). Shop `s`. Shared by the articles and the shop directory.
 */
export const shopInCatalogue = sql`s.status = 'published' and s.merged_into_id is null and not s.is_major_brand`;

/** Visibility of a catalogue article (plan, global constraints); the photo comes from the `img` join. */
const visible = sql`${shopInCatalogue} and p.hidden_at is null and p.removed_at is null`;

/** A card needs a name, a price and its currency (and a photo: the inner `img` join). */
const complete = sql`p.name is not null and p.price_cents is not null and p.currency is not null`;

/** The photo a card needs, where there is no `img` join. */
const hasImage = sql`exists (select 1 from product_images pic where pic.product_id = p.id)`;

/** A product an admin can file: complete and with a photo, whatever its shop's status. Product `p`. */
export const completeWithImage = sql`${complete} and ${hasImage}`;

/**
 * A product of « Découvrir », exactly as its grid shows it: visible and complete, with a photo. Product `p`, its shop
 * `s`. Used wherever the catalogue is counted or pictured (shop tiles, « boutique de la semaine », admin counts).
 */
export const inCatalogue = sql`${visible} and ${completeWithImage}`;

// --- Catalogue conforme au droit (docs/specs/2026-11-14-catalogue-conforme.md). ---

/** A shop with an « Accord de référencement »: its whole catalogue is public, photos and texts included. Shop `s`. */
export const partnerShop = sql`s.listing_agreement_at is not null`;

/**
 * Pasted by a user: a link she pasted (a user capture, whoever she is, even after her account went), or an item on
 * it kept by someone who is neither an admin nor a « Testeuse » (their « Je le veux » on an imported article must
 * not make it public). Product `p`.
 */
export const pastedByUser = sql`(exists (
    select 1 from captures pc where pc.product_id = p.id and pc.trigger = 'user'
  ) or exists (
    select 1 from items pit join "user" pu on pu.id = pit.user_id
    where pit.product_id = p.id and pu.role <> 'admin' and not pu.is_tester
  ))`;

/**
 * Who sees an article of « Découvrir », on top of `inCatalogue`: an admin or a « Testeuse » sees them all; anyone
 * else, the pasted ones and those of a partner shop (a full import alone stays private).
 */
export const visibleTo = (viewer: { privileged: boolean }): SQL =>
  viewer.privileged ? sql`true` : sql`(${partnerShop} or ${pastedByUser})`;

/** Whether the shop's photos and text may be shown: a partner shop, or an admin / « Testeuse » looking. Shop `s`. */
export const showsShopMedia = (viewer: { privileged: boolean }): SQL => (viewer.privileged ? sql`true` : partnerShop);

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
  shows_media: boolean;
  canonical_url: string;
  category_id: string | null;
  color_hex: string | null;
  [key: string]: unknown;
};

const toCard =
  (viewer: Viewer) =>
  (r: CardRow): CatalogCard => ({
    productId: r.id,
    name: r.name,
    shop: { id: r.shop_id, name: r.shop_name },
    // Never the shop's photo without its agreement (or an admin / « Testeuse »): the illustration instead.
    imageUrl: r.shows_media ? catalogImageUrl(r.image_id) : null,
    illustration: {
      kind: (r.category_id ? viewer.illustrationKinds.get(r.category_id) : undefined) ?? "other",
      color: r.color_hex && /^#[0-9A-Fa-f]{6}$/.test(r.color_hex) ? r.color_hex : null,
    },
    url: r.canonical_url,
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

/** Cards of the visible products matching `where`, in `orderBy`. */
async function selectCards(
  db: Database,
  viewer: Viewer,
  options: { where: SQL[]; orderBy: SQL; limit: number; extra?: SQL },
): Promise<CardRow[]> {
  const where = [complete, visible, visibleTo(viewer), ...options.where];
  const { rows } = await db.execute<CardRow>(sql`
    select p.id, p.name, s.id as shop_id, s.name as shop_name, img.id as image_id, p.price_cents,
      p.compare_at_cents, p.currency, ${sizeInStock(viewer)} as size_in_stock, ${wanted(viewer)} as wanted,
      ${showsShopMedia(viewer)} as shows_media, p.category_id, pcol.hex as color_hex,
      p.canonical_url
      ${options.extra ? sql`, ${options.extra}` : sql``}
    from products p
    join shops s on s.id = p.shop_id
    left join colors pcol on pcol.id = p.color_id
    join lateral (
      select pi.id from product_images pi where pi.product_id = p.id order by pi.position, pi.id limit 1
    ) img on true
    where ${sql.join(where, sql` and `)}
    order by ${options.orderBy}
    limit ${options.limit}`);
  return rows;
}

// --- The catalogue list. ---

type SortKey = { expr: SQL; type: KeyType };
const idKey: SortKey = { expr: sql`p.id`, type: "uuid" };
/**
 * « Nouveautés »: the dated products first, newest first (`published_at`: the shop's date, the hour first seen, or the
 * admin's); then the undated ones (`unknown`, a date never invented) in their shop's own order (`shop_rank`, newest
 * first for WooCommerce; never listed: last); then the id. Keyset keys are never null: an undated product sorts at the
 * epoch, before any real date, and its rank is negated so that the whole key goes one way.
 */
const UNDATED = "1970-01-01T00:00:00Z";
const onlineKey: SortKey = { expr: sql`coalesce(p.published_at, ${UNDATED}::timestamptz)`, type: "timestamptz" };
const rankKey: SortKey = { expr: sql`(-coalesce(p.shop_rank, 2147483647))`, type: "integer" };
const priceKey: SortKey = { expr: sql`p.price_cents`, type: "integer" };

/** Keyset of each sort: every key is non-null on a visible article and they all go one way. */
const SORTS: Record<CatalogSort, { keys: SortKey[]; desc: boolean }> = {
  new: { keys: [onlineKey, rankKey, idKey], desc: true },
  price_asc: { keys: [priceKey, idKey], desc: false },
  price_desc: { keys: [priceKey, idKey], desc: true },
  /**
   * The most liked first, then the newest. Under 3 people counts as none, so the order never tells that one or two
   * people have an article (the counter is shown from 3 too).
   */
  popular: {
    keys: [
      { expr: sql`(case when ${likesOf} >= ${LIKES_THRESHOLD} then ${likesOf} else 0 end)`, type: "integer" },
      onlineKey,
      rankKey,
      idKey,
    ],
    desc: true,
  },
};

const cursorSchema = z.object({ s: catalogSortSchema, k: z.array(z.string()).min(2).max(4) });

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
  const words = foldText(q)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const long = words.filter((w) => w.length > 1);
  return [...new Set(long.length ? long : words)].slice(0, MAX_SEARCH_TERMS);
}

/** Letters that lose no accent by decomposition (« ł », « ø », « ß »…): the same table as `catalog_fold` (0023). */
const NON_DECOMPOSING: Record<string, string> = {
  ð: "d",
  ø: "o",
  đ: "d",
  ħ: "h",
  ı: "i",
  ĸ: "k",
  ŀ: "l",
  ł: "l",
  ŋ: "n",
  ŧ: "t",
  ſ: "s",
  œ: "oe",
  æ: "ae",
  ß: "ss",
  ĳ: "ij",
  þ: "th",
};

/** Lowercase without accents, as the SQL `catalog_fold` does for Latin-1 and Latin Extended-A. */
export function foldText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[ðøđħıĸŀłŋŧſœæßĳþ]/g, (ch) => NON_DECOMPOSING[ch] ?? ch);
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
  if (query.q) {
    const terms = searchTerms(query.q);
    // Nothing searchable left (punctuation only): no article matches, rather than the whole catalogue.
    if (terms.length === 0) where.push(sql`false`);
    for (const term of terms) where.push(termMatches(term));
  }
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
  // An undated product (`unknown`) is never new.
  if (query.isNew) {
    where.push(sql`p.published_at >= ${new Date(now.getTime() - NEW_DAYS * 86_400_000).toISOString()}`);
  }
  // Strict: only what is known to fit her (one of her sizes available, or « taille unique » for a sized kind).
  // Without any size of
  // hers the filter is off (`hasSizes`, the web greys it out).
  if (query.mySize && hasSizes(viewer)) where.push(sql`${sizeInStock(viewer)} is true`);
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
    items: page.map(toCard(viewer)),
    hasSizes: hasSizes(viewer),
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
    extra: sql`p.color_id, p.material_id, p.description, p.shop_id as own_shop_id, ${likesOf} as likes,
      p.last_captured_at`,
  });
  if (!row) return null;
  const categoryId = row.category_id as string | null;
  const colorId = row.color_id as string | null;
  const price = Number(row.price_cents);
  const newest = sql.join(
    SORTS.new.keys.map((k) => sql`${k.expr} desc`),
    sql`, `,
  );

  const showsMedia = Boolean(row.shows_media);
  const [images, sizes, mine, close, sameShop, sameStyle, facts] = await Promise.all([
    showsMedia
      ? db
          .select({ id: schema.productImages.id })
          .from(schema.productImages)
          .where(sql`${schema.productImages.productId} = ${productId}`)
          .orderBy(schema.productImages.position, schema.productImages.id)
      : [],
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
    categoryId && colorId ? loadClosePieces(db, viewer, productId, categoryId, colorId) : [],
    selectCards(db, viewer, {
      where: [sql`p.shop_id = ${row.own_shop_id as string}`, sql`p.id <> ${productId}`],
      orderBy: newest,
      limit: CATALOG_DETAIL_LIMITS.sameShop,
    }),
    // Other shops: same category (weighs most), same color, or a price within 20 %.
    (() => {
      // Never null (an unfiled article): a null score would sort first.
      const sameCategory = categoryId ? sql`coalesce(p.category_id = ${categoryId}, false)` : sql`false`;
      const sameColor = colorId ? sql`coalesce(p.color_id = ${colorId}, false)` : sql`false`;
      const nearPrice = sql`(p.price_cents between ${Math.floor(price * (1 - NEAR_PRICE_RATIO))} and ${Math.ceil(
        price * (1 + NEAR_PRICE_RATIO),
      )})`;
      return selectCards(db, viewer, {
        where: [sql`p.shop_id <> ${row.own_shop_id as string}`, sql`(${sameCategory} or ${sameColor} or ${nearPrice})`],
        orderBy: sql`(4 * ${sameCategory}::int + 2 * ${sameColor}::int + ${nearPrice}::int) desc, ${newest}`,
        limit: CATALOG_DETAIL_LIMITS.sameStyle,
      });
    })(),
    loadFactNames(db, colorId, (row.material_id as string | null) ?? null),
  ]);

  const likes = Number(row.likes);
  const own = mine[0];
  const shopText = typeof row.description === "string" ? row.description.trim() : "";
  const factual = factualDescription({
    category: categoryFact(viewer, categoryId),
    color: facts.color,
    material: facts.material,
    sizes: sizes.filter((s) => s.available).map((s) => s.label),
  });
  const kind = categoryId ? viewer.sizeKinds.get(categoryId) : undefined;
  const mySizes = kind ? viewer.sizes[kind].filter((size) => size.trim() !== "") : [];
  return {
    ...toCard(viewer)(row),
    images: images.map((i) => catalogImageUrl(i.id)),
    // The shop's own words only with its agreement (or for an admin / « Testeuse »); otherwise facts only.
    description: showsMedia && shopText ? shopText : factual,
    sizes,
    mySizes,
    likes: likes >= LIKES_THRESHOLD ? likes : null,
    myItem: own ? { itemId: own.id, stage: own.stage as ItemStage } : null,
    close,
    sameShop: sameShop.map(toCard(viewer)),
    sameStyle: sameStyle.map(toCard(viewer)),
    checkedAt: row.last_captured_at ? new Date(row.last_captured_at as string | Date).toISOString() : null,
    // The route says whether a fresh read is under way (`requestSheetRefresh`).
    refreshing: false,
  };
}

/** The category of the sentence, with its ancestors' slugs (nearest first) so an unknown one takes its parent's noun. */
function categoryFact(viewer: Viewer, categoryId: string | null) {
  const category = categoryId ? viewer.categories.get(categoryId) : undefined;
  if (!category) return null;
  const parents: string[] = [];
  const seen = new Set([categoryId]);
  let parentId = category.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = viewer.categories.get(parentId);
    if (!parent) break;
    parents.push(parent.slug);
    parentId = parent.parentId;
  }
  return { slug: category.slug, name: category.name, parents };
}

/** The colour's and material's reference names (two small tables), for the factual sentence. */
async function loadFactNames(db: Database, colorId: string | null, materialId: string | null) {
  const [color, material] = await Promise.all([
    colorId
      ? db
          .select({ slug: schema.colors.slug, name: schema.colors.name })
          .from(schema.colors)
          .where(sql`${schema.colors.id} = ${colorId}`)
      : [],
    materialId
      ? db
          .select({ slug: schema.materials.slug, name: schema.materials.name })
          .from(schema.materials)
          .where(sql`${schema.materials.id} = ${materialId}`)
      : [],
  ]);
  return { color: color[0] ?? null, material: material[0] ?? null };
}

type CloseRow = {
  id: string;
  product_id: string | null;
  name: string;
  stage: ItemStage;
  cover_media_id: string | null;
  product_image_id: string | null;
  own_media_id: string | null;
};

/**
 * « Tu as déjà quelque chose de proche »: up to 3 of her own owned pieces (« Reçu » and « Dans mon dressing ») of the
 * viewer's profile, of the same category and color (her corrections first), newest first. Whatever their product's
 * catalogue visibility or price: they are hers. Only her own data is read.
 */
async function loadClosePieces(
  db: Database,
  viewer: Viewer,
  productId: string,
  categoryId: string,
  colorId: string,
): Promise<CatalogClosePiece[]> {
  if (!viewer.profileId) return [];
  const { rows } = await db.execute<CloseRow>(sql`
    select i.id, i.product_id, coalesce(i.name_override, ip.name, '') as name, i.stage, i.cover_media_id,
      (select pi.id from product_images pi where pi.product_id = i.product_id
        order by pi.position, pi.id limit 1) as product_image_id,
      (select im.media_id from item_media im where im.item_id = i.id
        order by im.position, im.id limit 1) as own_media_id
    from items i
    left join products ip on ip.id = i.product_id
    where i.user_id = ${viewer.userId} and i.profile_id = ${viewer.profileId}
      and i.deleted_at is null and i.stage = 'owned'
      and i.product_id is distinct from ${productId}::uuid
      and coalesce(i.category_id, ip.category_id) = ${categoryId}
      and coalesce(i.color_id, ip.color_id) = ${colorId}
    order by i.created_at desc, i.id desc
    limit ${CATALOG_DETAIL_LIMITS.close}`);
  return rows.map((r) => ({
    itemId: r.id,
    productId: r.product_id,
    name: r.name,
    // The item card's cover rule (`coverUrl` in item-view.ts).
    imageUrl: r.cover_media_id
      ? privateMediaUrl(r.cover_media_id)
      : r.product_image_id
        ? catalogImageUrl(r.product_image_id)
        : r.own_media_id
          ? privateMediaUrl(r.own_media_id)
          : null,
    stage: r.stage,
  }));
}

// --- Reports. ---

/** Records her report once (a second one changes nothing); false when the article is not visible or unknown. */
export async function reportProduct(
  db: Database,
  userId: string,
  productId: string,
  reason: ReportReason,
): Promise<boolean> {
  const viewer = { privileged: await isPrivileged(db, userId) };
  const { rows } = await db.execute<{ id: string }>(sql`
    select p.id from products p join shops s on s.id = p.shop_id
    where p.id = ${productId} and ${inCatalogue} and ${visibleTo(viewer)}`);
  if (rows.length === 0) return false;
  await db
    .insert(schema.productReports)
    .values({ productId, userId, reason })
    .onConflictDoNothing({ target: [schema.productReports.productId, schema.productReports.userId] });
  return true;
}
