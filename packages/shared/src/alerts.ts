import { z } from "zod";
import { currencySchema } from "./catalog";
import { sizeMatches } from "./catalogue";
import { allOrNoneIssues } from "./env";

const dateTimeSchema = z.iso.datetime({ offset: true });
const centsSchema = z.number().int().nonnegative().max(100_000_000);

export const ALERT_TIME_ZONE = "Europe/Paris";
/** A drop counts when the new price is at least this share under the previous one… */
export const REAL_DROP_PERCENT = 5;
/** …or at least this many cents under it. */
export const REAL_DROP_CENTS = 500;
/** No notification from this hour (Paris)… */
export const QUIET_FROM_HOUR = 22;
/** …until this hour (Paris), when the held ones go out. */
export const QUIET_UNTIL_HOUR = 8;
/** The digest hour stays out of the quiet hours (22:00–8:00). */
export const DIGEST_HOUR_MIN = 8;
export const DIGEST_HOUR_MAX = 21;
export const DEFAULT_DIGEST_HOUR = 18;
export const MAX_SALE_PERIOD_NAME = 80;
export const MAX_PUSH_ENDPOINT = 2048;

export const alertKindSchema = z.enum(["size_back", "target_price", "price_drop", "sale_period", "shop_promo"]);
export type AlertKind = z.infer<typeof alertKindSchema>;
/** The kinds about one item (the others are about a shop or the sales calendar). */
export const ITEM_ALERT_KINDS = ["size_back", "target_price", "price_drop"] as const satisfies readonly AlertKind[];
/** The kinds pushed one by one (held in the quiet hours, capped per day); the others go into the digest. */
export const IMMEDIATE_ALERT_KINDS = ["size_back", "target_price"] as const satisfies readonly AlertKind[];
/** An alert waiting for its digest: a digest kind (`pending`) or an immediate one the daily cap sent there. */
export const DIGEST_WAITING_STATUSES = ["pending", "digest"] as const satisfies readonly AlertStatus[];

/** `pending` waits for its send (or the digest), `digest` goes into the day's digest, `skipped` is never sent. */
export const alertStatusSchema = z.enum(["pending", "sent", "digest", "skipped"]);
export type AlertStatus = z.infer<typeof alertStatusSchema>;

/** « Nouvelles » shows 30 days: alerts done with (not waiting) go after 35 days, the dashboard's sends after 30. */
export const ALERT_EVENT_RETENTION_DAYS = 35;
export const ALERT_SEND_RETENTION_DAYS = 30;

/** Whether `nextCents` is a real drop from `previousCents`: at least 5 % or 5 € under it. */
export function isRealDrop(previousCents: number, nextCents: number): boolean {
  const drop = previousCents - nextCents;
  if (drop <= 0) return false;
  return drop >= REAL_DROP_CENTS || drop * 100 >= previousCents * REAL_DROP_PERCENT;
}

/**
 * The sizes watched on an item: its own size, else the sizes of the item's profile for its kind; « any » (back in
 * stock at all) when there is none or the kind has no sizes (accessories).
 */
export function watchedSizes(itemSize: string | null, profileSizes: string[], kindHasSizes: boolean): string[] | "any" {
  const own = itemSize?.trim();
  if (own) return [own];
  const sizes = profileSizes.map((size) => size.trim()).filter((size) => size !== "");
  if (!kindHasSizes || sizes.length === 0) return "any";
  return sizes;
}

/**
 * The shop's labels that make a watched size come back between two captures: in stock now, not before, and none of
 * the watched sizes was in stock before (« M » finds « 38 FR »… through `sizeMatches`). For « any », the labels back
 * in stock after nothing was. Empty when nothing came back.
 */
export function sizeCameBack(
  prev: Record<string, boolean>,
  next: Record<string, boolean>,
  watched: string[] | "any",
): string[] {
  const watches = (label: string) => watched === "any" || sizeMatches(watched, [label]) === true;
  const before = Object.keys(prev).filter((label) => prev[label] === true && watches(label));
  if (before.length > 0) return [];
  return Object.keys(next).filter((label) => next[label] === true && prev[label] !== true && watches(label));
}

const parisParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: ALERT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function partsOf(d: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = parisParts.formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Paris's offset from UTC at `d`, in milliseconds (+1 h in winter, +2 h in summer). */
function parisOffsetMs(d: Date): number {
  const p = partsOf(d);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000;
}

/** The instant of a Paris wall-clock time (the day may overflow: day + 1 is the next day). */
function parisTime(year: number, month: number, day: number, hour: number): Date {
  const wall = Date.UTC(year, month - 1, day, hour);
  const first = wall - parisOffsetMs(new Date(wall));
  return new Date(wall - parisOffsetMs(new Date(first)));
}

/** The calendar day in Paris, `YYYY-MM-DD`. */
export function parisDay(d: Date): string {
  const p = partsOf(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** The hour in Paris, 0–23. */
export function parisHour(d: Date): number {
  return partsOf(d).hour;
}

/** When an immediate alert born at `now` may go out: now, or 8:00 Paris when born in the quiet hours (22:00–8:00). */
export function nextSendAt(now: Date): Date {
  const p = partsOf(now);
  if (p.hour >= QUIET_UNTIL_HOUR && p.hour < QUIET_FROM_HOUR) return now;
  const day = p.hour >= QUIET_FROM_HOUR ? p.day + 1 : p.day;
  return parisTime(p.year, p.month, day, QUIET_UNTIL_HOUR);
}

const digestHourSchema = z.number().int().min(DIGEST_HOUR_MIN).max(DIGEST_HOUR_MAX);

/** Her notification settings (« Notifications »). Without a row: everything on, digest at 18:00. */
export const alertSettingsSchema = z.object({
  sizeBack: z.boolean(),
  targetPrice: z.boolean(),
  digest: z.boolean(),
  digestHour: digestHourSchema,
});
export type AlertSettings = z.infer<typeof alertSettingsSchema>;
export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  sizeBack: true,
  targetPrice: true,
  digest: true,
  digestHour: DEFAULT_DIGEST_HOUR,
};

/** `PATCH /api/me/alert-settings`: at least one field. */
export const alertSettingsPatchSchema = alertSettingsSchema
  .partial()
  .refine((v) => Object.values(v).some((value) => value !== undefined), { error: "at least one field" });
export type AlertSettingsPatch = z.infer<typeof alertSettingsPatchSchema>;

/** Push services' hosts, exactly. */
const PUSH_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"] as const;
/** Push services' domains, any host under them (`*.notify.windows.com`…). */
const PUSH_DOMAINS = ["push.services.mozilla.com", "notify.windows.com", "push.apple.com"] as const;

/**
 * Whether a push subscription's endpoint is a known push service, the only hosts the worker ever POSTs to (no
 * server-side request forgery through `endpoint`): `https:`, no credentials, no port but 443, and the host (lower case,
 * without a trailing dot) one of PUSH_HOSTS or under one of PUSH_DOMAINS.
 */
export function isPushEndpointAllowed(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return false;
  // `new URL` drops the default port (443) and keeps any other.
  if (url.port !== "" && url.port !== "443") return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return (
    (PUSH_HOSTS as readonly string[]).includes(host) ||
    PUSH_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
  );
}

/** A browser's `PushSubscription.toJSON()`; the API takes the device name from the request. */
export const pushSubscriptionInputSchema = z.object({
  endpoint: z.string().max(MAX_PUSH_ENDPOINT).refine(isPushEndpointAllowed, { error: "unknown push service" }),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(64),
  }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInputSchema>;

/** One of her devices (« Retirer »). */
export const pushSubscriptionViewSchema = z.object({
  id: z.uuid(),
  userAgent: z.string().nullable(),
  createdAt: dateTimeSchema,
  lastOkAt: dateTimeSchema.nullable(),
});
export type PushSubscriptionView = z.infer<typeof pushSubscriptionViewSchema>;

/**
 * One alert on « Nouvelles », as facts (the page words them). `title` is the item's name (item kinds), the shop's
 * (shop_promo) or the sales' (sale_period).
 */
export const alertEventViewSchema = z.object({
  id: z.uuid(),
  kind: alertKindSchema,
  itemId: z.uuid().nullable(),
  title: z.string(),
  shopName: z.string().nullable(),
  /** size_back: the shop's label back in stock. */
  sizeLabel: z.string().nullable(),
  /** target_price, price_drop: the new price and the one before. */
  priceCents: centsSchema.nullable(),
  previousCents: centsSchema.nullable(),
  /** target_price: the price she aimed at. */
  targetPriceCents: centsSchema.nullable(),
  currency: currencySchema.nullable(),
  /** sale_period: its name and first day. */
  salePeriodName: z.string().nullable(),
  startsOn: z.iso.date().nullable(),
  photoUrl: z.string().nullable(),
  /** Where it leads (the item's sheet or « Nouvelles »). */
  href: z.string().regex(/^\/(?!\/)/),
  createdAt: dateTimeSchema,
  readAt: dateTimeSchema.nullable(),
});
export type AlertEventView = z.infer<typeof alertEventViewSchema>;

export const alertPageSchema = z.object({ alerts: z.array(alertEventViewSchema), nextCursor: z.string().nullable() });
export type AlertPage = z.infer<typeof alertPageSchema>;

const salePeriodFields = z.object({
  name: z.string().trim().min(1).max(MAX_SALE_PERIOD_NAME),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
});
const endsAfterStart = (v: { startsOn: string; endsOn: string }) => v.endsOn >= v.startsOn;

/** Admin « Soldes »: a period, first and last day included (Paris), the end on or after the start. */
export const salePeriodInputSchema = salePeriodFields.refine(endsAfterStart, {
  error: "endsOn before startsOn",
  path: ["endsOn"],
});
export type SalePeriodInput = z.infer<typeof salePeriodInputSchema>;

export const salePeriodSchema = salePeriodFields
  .extend({ id: z.uuid() })
  .refine(endsAfterStart, { error: "endsOn before startsOn", path: ["endsOn"] });
export type SalePeriod = z.infer<typeof salePeriodSchema>;

/** `GET /api/admin/sale-periods`: every period, the latest start first. */
export const salePeriodListSchema = z.object({ periods: z.array(salePeriodSchema) });
export type SalePeriodList = z.infer<typeof salePeriodListSchema>;

/** Where an alert about an item leads: the item's sheet, in the item's profile (its current one). */
export const alertItemHref = (productId: string, profileId: string) => `/produits/${productId}?profil=${profileId}`;

/** Where the other alerts (sales, shop promo, the digest) lead. */
export const ALERTS_PAGE_HREF = "/nouvelles";

/** « Nouvelles »: how far back, and how many a page holds. */
export const ALERTS_DAYS = 30;
export const ALERTS_PAGE_SIZE = 30;

/** `POST /api/me/alerts/read`: these of her alerts (all of them without `ids`). */
export const alertReadInputSchema = z.object({
  ids: z
    .array(z.uuid())
    .min(1)
    .max(ALERTS_PAGE_SIZE * 4)
    .optional(),
});
export type AlertReadInput = z.infer<typeof alertReadInputSchema>;
export const alertReadResultSchema = z.object({ read: z.number().int().nonnegative() });

/** `GET /api/push/key`: the VAPID public key the browser subscribes with. */
export const pushKeySchema = z.object({ publicKey: z.string() });
export type PushKey = z.infer<typeof pushKeySchema>;

export const pushSubscriptionListSchema = z.object({ subscriptions: z.array(pushSubscriptionViewSchema) });
export type PushSubscriptionList = z.infer<typeof pushSubscriptionListSchema>;

/** The three VAPID variables (Web Push): all three set, or none (push off). */
export const VAPID_VARIABLES = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;

/** Unpadded base64url of exactly `bytes` bytes. */
const base64url = (bytes: number) => z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((bytes * 4) / 3)}}$`));

/**
 * The VAPID variables of the worker and API schemas: the public key is an uncompressed P-256 point (65 bytes, first
 * byte 0x04, so « B… »), the private key 32 bytes, the subject an https: URL or a mailto: address.
 */
export const vapidEnvShape = {
  VAPID_PUBLIC_KEY: base64url(65)
    .refine((v) => v.startsWith("B"), "expected an uncompressed P-256 public key (base64url, starts with B)")
    .optional(),
  VAPID_PRIVATE_KEY: base64url(32).optional(),
  VAPID_SUBJECT: z
    .string()
    .refine((v) => {
      try {
        const protocol = new URL(v).protocol;
        return protocol === "https:" || protocol === "mailto:";
      } catch {
        return false;
      }
    }, "expected an https: URL or a mailto: address")
    .optional(),
};

type VapidEnv = { [K in (typeof VAPID_VARIABLES)[number]]?: string | undefined };

/** The issues of a partial VAPID configuration (one per missing variable); none when all three or none are set. */
export function vapidEnvIssues(env: VapidEnv): { path: string; message: string }[] {
  return allOrNoneIssues(env, VAPID_VARIABLES, "required (all VAPID_* variables go together)");
}

export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

/** The VAPID keys, or null when push is off (none set). */
export function vapidConfig(env: VapidEnv): VapidConfig | null {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = env;
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}
