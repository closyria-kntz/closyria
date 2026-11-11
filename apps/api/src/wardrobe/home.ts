import { and, asc, type Database, desc, eq, gte, inArray, isNull, lt, ne, or, schema, sql } from "@closyria/db";
import {
  HOME_NEWS_DAYS,
  HOME_NEWS_LIMIT,
  HOME_WISHES_LIMIT,
  type HomeNews,
  type HomeView,
  type ItemView,
} from "@closyria/shared";
import { parisDayStart } from "./budgets";
import { loadItemViews } from "./item-view";
import { giftReminderDue } from "./wishlists";

/** A capture of a product: its price and which sizes were in stock. */
type Point = { productId: string; seenAt: Date; priceCents: number; sizes: Record<string, boolean> };

/** Her news before the item data (name, photo) is laid on it. */
type Draft = Omit<HomeNews, "title" | "detail" | "photoUrl"> & { title?: string; detail?: string | null };

const EMPTY_FACTS = {
  priceCents: null,
  previousPriceCents: null,
  currency: null,
  sizeLabel: null,
  authorName: null,
  count: null,
  groupOrderStatus: null,
} as const;

/** The first point of the last run of `points` (oldest first) where `same` holds against the latest one. */
function runStart(points: Point[], same: (point: Point) => boolean): number {
  let start = points.length - 1;
  while (start > 0 && same(points[start - 1] as Point)) start -= 1;
  return start;
}

/**
 * The latest price is lower than the price before it, and it went down since `since` (as the product page's
 * « −13 € » reads it).
 */
export function priceDropOf(points: Point[], since: Date) {
  const latest = points.at(-1);
  if (!latest) return null;
  const start = runStart(points, (p) => p.priceCents === latest.priceCents);
  const previous = points[start - 1];
  const from = points[start] as Point;
  if (!previous || latest.priceCents >= previous.priceCents || from.seenAt < since) return null;
  return { at: from.seenAt, priceCents: latest.priceCents, previousPriceCents: previous.priceCents };
}

/** A size label as the product page compares it: trimmed, lower case (« m » is « M »). */
const sizeKey = (label: string) => label.trim().toLowerCase();

/** Whether the size `key` was in stock at `point` (undefined when the shop did not list it). */
function stockOf(point: Point, key: string): { label: string; available: boolean } | undefined {
  const entry = Object.entries(point.sizes).find(([label]) => sizeKey(label) === key);
  return entry ? { label: entry[0], available: entry[1] } : undefined;
}

/**
 * Her size (matched like the product page: trimmed, any case) is in stock at the latest capture, was out at the
 * capture before, and came back since `since`. `label` is the shop's spelling of it.
 */
export function sizeBackOf(points: Point[], size: string, since: Date) {
  const key = sizeKey(size);
  const latest = points.at(-1);
  const now = latest ? stockOf(latest, key) : undefined;
  if (!now?.available) return null;
  const start = runStart(points, (p) => stockOf(p, key)?.available === true);
  const previous = points[start - 1];
  const from = points[start] as Point;
  if (!previous || stockOf(previous, key)?.available !== false || from.seenAt < since) return null;
  return { at: from.seenAt, label: now.label };
}

/** A guest has no name of her own (Better Auth calls her « Anonymous »); an e-mail is not a first name either. */
export function firstNameOf(row: { name: string; isAnonymous: boolean | null } | undefined): string | null {
  if (!row || row.isAnonymous) return null;
  const first = row.name.trim().split(/\s+/)[0] ?? "";
  return first && !first.includes("@") ? first : null;
}

/** Price drops and sizes back on her wishes, from the captures of the last HOME_NEWS_DAYS days. */
async function catalogNews(db: Database, userId: string, since: Date): Promise<Draft[]> {
  const wishes = await db
    .select({ id: schema.items.id, productId: schema.items.productId, sizeLabel: schema.items.sizeLabel })
    .from(schema.items)
    .innerJoin(schema.products, eq(schema.products.id, schema.items.productId))
    .where(
      and(
        eq(schema.items.userId, userId),
        isNull(schema.items.deletedAt),
        eq(schema.items.stage, "spotted"),
        ne(schema.products.captureStatus, "manual"),
      ),
    );
  const productIds = [...new Set(wishes.flatMap((w) => (w.productId ? [w.productId] : [])))];
  if (productIds.length === 0) return [];
  const columns = {
    productId: schema.productHistory.productId,
    seenAt: schema.productHistory.seenAt,
    priceCents: schema.productHistory.priceCents,
    sizes: schema.productHistory.sizes,
  };
  // The captures of the window, and the last one before it (what a drop or a return is measured against).
  const [recent, before] = await Promise.all([
    db
      .select(columns)
      .from(schema.productHistory)
      .where(and(inArray(schema.productHistory.productId, productIds), gte(schema.productHistory.seenAt, since)))
      .orderBy(asc(schema.productHistory.seenAt), asc(schema.productHistory.id)),
    db
      .selectDistinctOn([schema.productHistory.productId], columns)
      .from(schema.productHistory)
      .where(and(inArray(schema.productHistory.productId, productIds), lt(schema.productHistory.seenAt, since)))
      .orderBy(schema.productHistory.productId, desc(schema.productHistory.seenAt), desc(schema.productHistory.id)),
  ]);
  const points = new Map<string, Point[]>();
  for (const point of [...before, ...recent])
    points.set(point.productId, [...(points.get(point.productId) ?? []), point]);
  const drafts: Draft[] = [];
  for (const wish of wishes) {
    const history = wish.productId ? points.get(wish.productId) : undefined;
    if (!wish.productId || !history) continue;
    const href = `/produits/${wish.productId}`;
    const drop = priceDropOf(history, since);
    if (drop) {
      drafts.push({
        ...EMPTY_FACTS,
        kind: "price_drop",
        itemId: wish.id,
        href,
        at: drop.at.toISOString(),
        priceCents: drop.priceCents,
        previousPriceCents: drop.previousPriceCents,
      });
    }
    const back = wish.sizeLabel ? sizeBackOf(history, wish.sizeLabel, since) : null;
    if (back) {
      drafts.push({
        ...EMPTY_FACTS,
        kind: "size_back",
        itemId: wish.id,
        href,
        at: back.at.toISOString(),
        sizeLabel: back.label,
      });
    }
  }
  return drafts;
}

/** Friends' opinions she has not seen yet: one news per item of a list, with the newest author and note. */
async function opinionNews(db: Database, userId: string): Promise<Draft[]> {
  const rows = await db
    .select({
      wishlistId: schema.wishlistOpinions.wishlistId,
      itemId: schema.wishlistOpinions.itemId,
      authorName: schema.wishlistOpinions.authorName,
      note: schema.wishlistOpinions.note,
      updatedAt: schema.wishlistOpinions.updatedAt,
    })
    .from(schema.wishlistOpinions)
    .innerJoin(schema.wishlists, eq(schema.wishlists.id, schema.wishlistOpinions.wishlistId))
    .innerJoin(schema.items, eq(schema.items.id, schema.wishlistOpinions.itemId))
    .where(
      and(
        eq(schema.wishlists.userId, userId),
        isNull(schema.items.deletedAt),
        // New = written or changed after she last looked (all of them when she never did), as the lists count them.
        or(
          isNull(schema.wishlists.opinionsSeenAt),
          sql`${schema.wishlistOpinions.updatedAt} > ${schema.wishlists.opinionsSeenAt}`,
        ),
      ),
    )
    .orderBy(desc(schema.wishlistOpinions.updatedAt), desc(schema.wishlistOpinions.id));
  const byItem = new Map<string, Draft>();
  for (const row of rows) {
    const key = `${row.wishlistId}:${row.itemId}`;
    const seen = byItem.get(key);
    if (seen) {
      seen.count = (seen.count ?? 0) + 1;
      continue;
    }
    byItem.set(key, {
      ...EMPTY_FACTS,
      kind: "opinion",
      itemId: row.itemId,
      href: `/listes/${row.wishlistId}`,
      at: row.updatedAt.toISOString(),
      detail: row.note,
      authorName: row.authorName,
      count: 1,
    });
  }
  return [...byItem.values()];
}

/** Her running group orders (open or closed), and the gift reminders that are due. */
async function listNews(db: Database, userId: string, now: Date): Promise<Draft[]> {
  const [orders, lists] = await Promise.all([
    db
      .select({
        wishlistId: schema.groupOrders.wishlistId,
        listName: schema.wishlists.name,
        status: schema.groupOrders.status,
        shopName: schema.shops.name,
        updatedAt: schema.groupOrders.updatedAt,
      })
      .from(schema.groupOrders)
      .innerJoin(schema.wishlists, eq(schema.wishlists.id, schema.groupOrders.wishlistId))
      .innerJoin(schema.shops, eq(schema.shops.id, schema.groupOrders.shopId))
      .where(and(eq(schema.wishlists.userId, userId), inArray(schema.groupOrders.status, ["open", "closed"]))),
    db.select().from(schema.wishlists).where(eq(schema.wishlists.userId, userId)),
  ]);
  const drafts: Draft[] = orders.map((order) => ({
    ...EMPTY_FACTS,
    kind: "group_order",
    href: `/listes/${order.wishlistId}/commande-groupee`,
    at: order.updatedAt.toISOString(),
    title: order.listName,
    detail: order.shopName,
    groupOrderStatus: order.status as "open" | "closed",
  }));
  for (const list of lists) {
    if (!list.giftDate || !giftReminderDue(list, now)) continue;
    // Due from the day after her occasion, Paris time.
    const due = parisDayStart(new Date(`${list.giftDate}T12:00:00.000Z`), 1);
    drafts.push({
      ...EMPTY_FACTS,
      kind: "gift_reminder",
      href: `/listes/${list.id}`,
      at: due.toISOString(),
      title: list.name,
      detail: list.giftOccasion,
    });
  }
  return drafts;
}

/** « Tes envies du moment »: her wishes, priority ones first, then the newest. */
async function wishesOf(db: Database, userId: string, now: Date): Promise<ItemView[]> {
  const rows = await db
    .select({ id: schema.items.id })
    .from(schema.items)
    .where(and(eq(schema.items.userId, userId), isNull(schema.items.deletedAt), eq(schema.items.stage, "spotted")))
    .orderBy(desc(schema.items.priority), desc(schema.items.createdAt), desc(schema.items.id))
    .limit(HOME_WISHES_LIMIT);
  return loadItemViews(
    db,
    userId,
    rows.map((r) => r.id),
    now,
  );
}

const newestFirst = (a: HomeNews, b: HomeNews) => b.at.localeCompare(a.at) || a.href.localeCompare(b.href);

/**
 * What « Accueil » shows (refonte Boudoir, spec R3), from data the app already keeps: price drops and sizes back on
 * her wishes (last HOME_NEWS_DAYS days), friends' opinions she has not seen, her running group orders and the gift
 * reminders that are due. The « une » is the newest news with a photo; with it, at most HOME_NEWS_LIMIT news.
 */
export async function homeView(db: Database, userId: string, now: Date): Promise<HomeView> {
  const since = new Date(now.getTime() - HOME_NEWS_DAYS * 86_400_000);
  const [[account], [kept], catalog, opinions, lists, wishes] = await Promise.all([
    db
      .select({ name: schema.user.name, isAnonymous: schema.user.isAnonymous })
      .from(schema.user)
      .where(eq(schema.user.id, userId)),
    db
      .select({ id: schema.items.id })
      .from(schema.items)
      .where(and(eq(schema.items.userId, userId), isNull(schema.items.deletedAt)))
      .limit(1),
    catalogNews(db, userId, since),
    opinionNews(db, userId),
    listNews(db, userId, now),
    wishesOf(db, userId, now),
  ]);
  const drafts = [...catalog, ...opinions, ...lists];
  const itemIds = [...new Set(drafts.flatMap((d) => (d.itemId ? [d.itemId] : [])))];
  const views = new Map((await loadItemViews(db, userId, itemIds, now)).map((v) => [v.id, v]));
  const all: HomeNews[] = drafts
    .flatMap((draft): HomeNews[] => {
      if (!draft.itemId) return [{ ...draft, title: draft.title ?? "", detail: draft.detail ?? null, photoUrl: null }];
      const item = views.get(draft.itemId);
      if (!item) return [];
      const facts = draft.kind === "price_drop" ? { currency: item.product.currency } : ({} as Partial<HomeNews>);
      return [
        {
          ...draft,
          ...facts,
          title: item.name?.trim() || item.product.shop.name,
          detail: draft.kind === "opinion" ? (draft.detail ?? null) : item.product.shop.name,
          photoUrl: item.coverUrl,
        },
      ];
    })
    .sort(newestFirst);
  const une = all.find((news) => news.photoUrl !== null) ?? null;
  const news = all.filter((n) => n !== une).slice(0, HOME_NEWS_LIMIT - (une ? 1 : 0));
  return { greetingName: firstNameOf(account), hasItems: kept !== undefined, une, news, wishes };
}
