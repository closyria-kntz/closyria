import { z } from "zod";
import { currencySchema } from "./catalog";
import { groupOrderStatusSchema } from "./group-orders";
import { itemViewSchema } from "./wardrobe";

const dateTimeSchema = z.iso.datetime({ offset: true });
const centsSchema = z.number().int().nonnegative().max(100_000_000);

/** How far back a price drop or a size back still counts as news on « Accueil ». */
export const HOME_NEWS_DAYS = 7;
/** At most this many news, the « une » included. */
export const HOME_NEWS_LIMIT = 5;
/** « Tes envies du moment »: at most this many cards. */
export const HOME_WISHES_LIMIT = 4;

export const homeNewsKindSchema = z.enum([
  "price_drop",
  "size_back",
  "target_price",
  "opinion",
  "group_order",
  "gift_reminder",
  "sale_period",
  "shop_promo",
]);
export type HomeNewsKind = z.infer<typeof homeNewsKindSchema>;

/**
 * Something that changed for her (`target_price`, `sale_period`, `shop_promo`: her alerts of the last HOME_NEWS_DAYS days, `title`
 * being the sales' name or the shop's), built only from data the app already keeps (refonte Boudoir, spec R3). The API
 * gives facts, never sentences: the page words them. `title` is what it is about (the item's name, or the list's
 * name for list news), `detail` its second line as data (the shop, a friend's note, the occasion).
 */
export const homeNewsSchema = z.object({
  kind: homeNewsKindSchema,
  itemId: z.uuid().optional(),
  title: z.string(),
  detail: z.string().nullable(),
  /** Where « Voir » / « Lire » / « Ouvrir » leads (an address of the app). */
  href: z.string().startsWith("/"),
  at: dateTimeSchema,
  /** The item's photo, when there is one (the « une » is the newest news with a photo). */
  photoUrl: z.string().nullable(),
  /** price_drop: the new price, the one before and their currency (target_price: the price reached). */
  priceCents: centsSchema.nullable(),
  previousPriceCents: centsSchema.nullable(),
  currency: currencySchema.nullable(),
  /** target_price: the price she aimed at (`priceCents` is the price reached). */
  targetPriceCents: centsSchema.nullable(),
  /** size_back: her size, in stock again. */
  sizeLabel: z.string().nullable(),
  /** opinion: the newest author, and how many new opinions on that item. */
  authorName: z.string().nullable(),
  count: z.number().int().nonnegative().nullable(),
  /** group_order: open or closed. */
  groupOrderStatus: groupOrderStatusSchema.nullable(),
  /** sale_period: the first day of the sales (`title` is their name). */
  startsOn: z.iso.date().nullable(),
});
export type HomeNews = z.infer<typeof homeNewsSchema>;

/** `GET /api/me/home`: what « Accueil » shows. */
export const homeViewSchema = z.object({
  /** Her first name; null for a guest or an account without one. */
  greetingName: z.string().nullable(),
  /** False for a new account (nothing kept yet): the page explains what to do. */
  hasItems: z.boolean(),
  /** The newest news with a photo; it is not repeated in `news`. */
  une: homeNewsSchema.nullable(),
  /** The other news, newest first; with the « une », at most HOME_NEWS_LIMIT. */
  news: z.array(homeNewsSchema).max(HOME_NEWS_LIMIT),
  /** « Tes envies du moment »: her wishes, priority ones first, then the newest. */
  wishes: z.array(itemViewSchema).max(HOME_WISHES_LIMIT),
});
export type HomeView = z.infer<typeof homeViewSchema>;
