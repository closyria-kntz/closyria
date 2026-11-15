import { z } from "zod";
import { parisDay } from "./alerts";
import { currencySchema } from "./catalog";
import { isInstagramUrl } from "./catalog-url";
import { itemStageSchema, MAX_NOTES, MAX_SIZE_LABEL } from "./wardrobe";

/**
 * « Après la commande » (docs/specs/2026-11-14-apres-commande.md): orders read from a forwarded e-mail, typed by hand
 * or born from a pasted tracking number, their parcels and the return deadline of what was delivered.
 */

const dateTimeSchema = z.iso.datetime({ offset: true });
const centsSchema = z.number().int().nonnegative().max(100_000_000);
const uuidSchema = z.uuid();

export const orderStatusSchema = z.enum(["draft", "confirmed", "dismissed"]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;
export const orderSourceSchema = z.enum(["email", "manual", "tracking"]);
export type OrderSource = z.infer<typeof orderSourceSchema>;
export const orderParseMethodSchema = z.enum(["known", "ai", "manual"]);
export type OrderParseMethod = z.infer<typeof orderParseMethodSchema>;
export const inboundEmailStatusSchema = z.enum(["ignored", "queued", "parsed", "failed"]);
export type InboundEmailStatus = z.infer<typeof inboundEmailStatusSchema>;
export const parcelStatusSchema = z.enum([
  "pending",
  "in_transit",
  "out_for_delivery",
  "pickup_ready",
  "delivered",
  "exception",
  "unknown",
]);
export type ParcelStatus = z.infer<typeof parcelStatusSchema>;
export const carrierSchema = z.enum([
  "colissimo",
  "lettre_suivie",
  "chronopost",
  "mondial_relay",
  "gls",
  "dpd",
  "colis_prive",
  "ups",
  "dhl",
]);
export type Carrier = z.infer<typeof carrierSchema>;

/** Carriers followed through La Poste's own API (« Okapi »); the others go through the aggregator. */
export const LA_POSTE_CARRIERS = ["colissimo", "lettre_suivie", "chronopost"] as const satisfies readonly Carrier[];

export const MAX_ORDER_LINES = 30;
export const MAX_ORDER_LINE_NAME = 200;
export const MAX_ORDER_LINE_COLOR = 60;
export const MAX_ORDER_LINE_QUANTITY = 99;
export const MAX_EXTERNAL_REF = 64;
export const MAX_SHOP_NAME = 120;
export const MAX_TRACKING_NUMBER = 40;
export const MIN_TRACKING_NUMBER = 6;
export const MAX_PARCEL_EVENT_LABEL = 200;
/** Raw e-mails are kept this long at most (to correct a reading), then purged. */
export const INBOUND_EMAIL_RETENTION_DAYS = 30;
/**
 * A received e-mail's row (her own address, dates, status: no content) is deleted this long after reception, its raw
 * message long gone; an order it became keeps everything she validated (`orders.inbound_email_id` set to null).
 */
export const INBOUND_EMAIL_ROW_DAYS = 90;
/** Default return delay of a shop, in days from the delivery (`shops.return_days`). */
export const DEFAULT_RETURN_DAYS = 14;
export const MAX_RETURN_DAYS = 365;

// --- Carriers ----------------------------------------------------------------------------------------------------

/** A pasted tracking number without spaces or dashes, in capitals. */
export function normalizeTrackingNumber(raw: string): string {
  return raw.replace(/[\s-]+/g, "").toUpperCase();
}

/** UPU S10 check digit of the 8 serial digits (weights 8 6 4 2 3 5 9 7; 10 → 0, 11 → 5). */
function s10CheckDigit(serial: string): number {
  const weights = [8, 6, 4, 2, 3, 5, 9, 7];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(serial[i]), 0);
  const check = 11 - (sum % 11);
  return check === 10 ? 0 : check === 11 ? 5 : check;
}

/** UPS check digit of the 15 characters after « 1Z » (letters count (code − 63) mod 10, even positions doubled). */
function upsCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body.charAt(i);
    const value = /\d/.test(ch) ? Number(ch) : (ch.charCodeAt(0) - 63) % 10;
    sum += i % 2 === 1 ? value * 2 : value;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * The carrier a tracking number belongs to, guessed from its format only. Conservative: a shape shared by several
 * carriers (10 or 12 digits, a DHL Express waybill, Colis Privé's numbers…) or unknown gives null, and she picks the
 * carrier herself; a wrong guess would send the tracking to the wrong service.
 *
 * - La Poste, domestic (13 characters: digit, letter, 11 digits): 1K/1L Lettre suivie, 6–9 + letter Colissimo.
 * - La Poste, international (UPU S10 « CB123456785FR », check digit verified, FR only): C Colissimo, L Lettre suivie,
 *   E (EMS) Chronopost.
 * - UPS: « 1Z » + 16 characters, check digit verified. DHL eCommerce: « JJD » + 18 digits, « JVGL » + 16 to 20 digits.
 * These carry their own signature and are recognised whatever `hint` says.
 *
 * Bare digits carry none (Mondial Relay 8, GLS 11 or 12, DPD 14 could be anything): they are accepted only to confirm
 * the carrier she picked (`hint`), when the number has that carrier's shape; otherwise null.
 */
export function detectCarrier(trackingNumber: string, hint?: Carrier | null): Carrier | null {
  const n = normalizeTrackingNumber(trackingNumber);
  if (n.length < MIN_TRACKING_NUMBER || n.length > MAX_TRACKING_NUMBER || !/^[0-9A-Z]+$/.test(n)) return null;

  const domestic = /^(\d)([A-Z])\d{11}$/.exec(n);
  if (domestic) {
    const [, digit, letter] = domestic;
    if (digit === "1" && (letter === "K" || letter === "L")) return "lettre_suivie";
    if (digit !== undefined && digit >= "6") return "colissimo";
    return null;
  }

  const s10 = /^([A-Z])[A-Z](\d{8})(\d)FR$/.exec(n);
  if (s10) {
    const [, service, serial = "", check] = s10;
    if (s10CheckDigit(serial) !== Number(check)) return null;
    if (service === "C") return "colissimo";
    if (service === "L") return "lettre_suivie";
    if (service === "E") return "chronopost";
    return null;
  }

  const ups = /^1Z([0-9A-Z]{15})(\d)$/.exec(n);
  if (ups) return upsCheckDigit(ups[1] ?? "") === Number(ups[2]) ? "ups" : null;

  if (/^JJD\d{18}$/.test(n) || /^JVGL\d{16,20}$/.test(n)) return "dhl";

  if (hint && /^\d+$/.test(n) && DIGITS_ONLY_LENGTHS[hint]?.includes(n.length)) return hint;
  return null;
}

/** Lengths of the digits-only numbers each carrier uses, confirmed only by her choice of carrier. */
const DIGITS_ONLY_LENGTHS: Partial<Record<Carrier, readonly number[]>> = {
  mondial_relay: [8],
  gls: [11, 12],
  dpd: [14],
};

// --- Dates and rhythm --------------------------------------------------------------------------------------------

/**
 * The last day she can send a delivered item back, `YYYY-MM-DD` in Paris: the Paris day of the delivery plus
 * `returnDays` calendar days (never 24-hour blocks, so a change of summer time does not move it).
 */
export function returnDeadline(deliveredAt: Date, returnDays: number): string {
  if (!Number.isInteger(returnDays) || returnDays < 0) throw new RangeError("returnDays must be a whole number ≥ 0");
  const [year, month, day] = parisDay(deliveredAt).split("-").map(Number);
  const deadline = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + returnDays));
  return deadline.toISOString().slice(0, 10);
}

const HOUR_MS = 3_600_000;
/** Out for delivery or at a pickup point: checked every 2 hours; other steps every 6 hours. */
export const PARCEL_CHECK_FAST_HOURS = 2;
export const PARCEL_CHECK_SLOW_HOURS = 6;
/** A parcel is followed this long at most after its tracking started. */
export const PARCEL_CHECK_DAYS = 30;
/**
 * Checks in a row that got no answer (carrier down, timeout, unreadable answer, number unknown to the carrier) before
 * the parcel turns `unknown`, silently (RF 4); it is still checked until `check_until`.
 */
export const PARCEL_MAX_CHECK_FAILURES = 3;

/** When to ask the carrier again about a parcel in `status`; null once delivered (the tracking stops). */
export function nextParcelCheck(status: ParcelStatus, now: Date): Date | null {
  switch (status) {
    case "delivered":
      return null;
    case "out_for_delivery":
    case "pickup_ready":
      return new Date(now.getTime() + PARCEL_CHECK_FAST_HOURS * HOUR_MS);
    case "pending":
    case "in_transit":
    case "exception":
    case "unknown":
      return new Date(now.getTime() + PARCEL_CHECK_SLOW_HOURS * HOUR_MS);
  }
}

/**
 * `nextParcelCheck`, never past the end of the tracking (`check_until`): the last check happens at `checkUntil`; null
 * once delivered or when the tracking is over.
 */
export function nextParcelCheckClamped(status: ParcelStatus, now: Date, checkUntil: Date): Date | null {
  const next = nextParcelCheck(status, now);
  if (!next || checkUntil.getTime() <= now.getTime()) return null;
  return next.getTime() > checkUntil.getTime() ? checkUntil : next;
}

/**
 * What the purge does with a received e-mail once past `purge_after`: an ignored one, or a failed one no order points
 * to, is deleted; the others keep their row (an order's origin, the admin's reading stats) and lose their raw message.
 */
export function inboundEmailPurge(status: InboundEmailStatus, referencedByOrder: boolean): "delete" | "clear_raw" {
  if (status === "ignored") return "delete";
  if (status === "failed" && !referencedByOrder) return "delete";
  return "clear_raw";
}

/** The end of a parcel's tracking (`parcels.check_until`), started at `start`. */
export function parcelCheckUntil(start: Date): Date {
  return new Date(start.getTime() + PARCEL_CHECK_DAYS * 24 * HOUR_MS);
}

// --- Returns and « Tu as reçu ta commande ? » (Task 6) ------------------------------------------------------------

/** « Plus que 3 jours pour retourner {article} »: this many Paris days before the return deadline. */
export const RETURN_REMINDER_DAYS = 3;
/** « Tu as reçu ta commande {boutique} ? »: this many days after the shipping (else the validation) without news… */
export const RECEIVED_QUESTION_DAYS = 10;
/** …and once more at this many days when she answered « Pas encore »; then never again. */
export const RECEIVED_QUESTION_AGAIN_DAYS = 20;

const dayParts = (day: string) => {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1);
};

/** A Paris calendar day (`YYYY-MM-DD`) plus `days` calendar days. */
export function addParisDays(day: string, days: number): string {
  return new Date(dayParts(day) + days * 24 * HOUR_MS).toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to` (both `YYYY-MM-DD`), negative when `to` comes first. */
export function parisDaysBetween(from: string, to: string): number {
  return Math.round((dayParts(to) - dayParts(from)) / (24 * HOUR_MS));
}

/**
 * Which « Tu as reçu ta commande ? » is due for an order still without news, counted in Paris calendar days (the job
 * runs at 9:00: a parcel shipped at 15:00 on the 5th is asked about on the 15th): the first RECEIVED_QUESTION_DAYS days
 * after `referenceAt` (its first parcel's earliest step or creation, else its validation); a second
 * RECEIVED_QUESTION_AGAIN_DAYS days after it, only after her « Pas encore »; never a third. Null when none is due.
 */
export function receivedQuestionDue(
  order: { referenceAt: Date; askedAt: Date | null; notYetAt: Date | null; askedAgainAt: Date | null },
  now: Date,
): "first" | "again" | null {
  const days = parisDaysBetween(parisDay(order.referenceAt), parisDay(now));
  if (!order.askedAt) return days >= RECEIVED_QUESTION_DAYS ? "first" : null;
  if (order.notYetAt && !order.askedAgainAt && days >= RECEIVED_QUESTION_AGAIN_DAYS) return "again";
  return null;
}

/** `POST /api/me/orders/{id}/received`: « Oui » (her articles go to « Reçu ») or « Pas encore ». */
export const orderReceivedAnswerSchema = z.object({ answer: z.enum(["yes", "not_yet"]) });
export type OrderReceivedAnswer = z.infer<typeof orderReceivedAnswerSchema>;

// --- Order addresses and received e-mails ------------------------------------------------------------------------

/** Largest e-mail received (the raw message, headers included); a larger one is refused, nothing stored. */
export const INBOUND_EMAIL_MAX_BYTES = 2 * 1024 * 1024;
/** Accepted e-mails stored per address and per 24 hours at most. */
export const MAX_INBOUND_EMAILS_PER_DAY = 100;
/** Ignored ones (not from her) kept per address and per 24 hours at most; beyond, nothing (a flood fills nothing). */
export const MAX_IGNORED_INBOUND_EMAILS_PER_DAY = 20;
/** An accepted e-mail still `queued` without its raw message after this long was never finished: the purge fails it. */
export const STUCK_INBOUND_EMAIL_MINUTES = 60;
/** How long Gmail's forwarding confirmation code is shown. */
export const GMAIL_CODE_HOURS = 24;

/** Storage key of a raw e-mail, under her own prefix like her photos. */
export function rawEmailKey(userId: string, inboundEmailId: string): string {
  return `users/${userId}/inbound/${inboundEmailId}.eml`;
}
/** The queue that reads an accepted e-mail (`{ inboundEmailId }`), filled by the API, worked by the worker. */
export const ORDER_EMAIL_PARSE_QUEUE = "order-email-parse";
export const orderEmailParseJobSchema = z.object({ inboundEmailId: uuidSchema }).strict();
export type OrderEmailParseJob = z.infer<typeof orderEmailParseJobSchema>;

/** The 4 random characters of an address: no i, l, o, 0 or 1, which read alike. */
export const ORDER_INBOX_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const ORDER_INBOX_CODE_LENGTH = 4;
/** Longest first-name part of an address (« marie-claire » fits). */
export const MAX_ORDER_INBOX_SLUG = 20;
const ORDER_INBOX_FALLBACK = "commande";

/** The domain of the order addresses: its own for prod, `commandes.dev.closyria.com` everywhere else. */
export function orderInboxDomain(appEnv: "development" | "test" | "dev" | "prod"): string {
  return appEnv === "prod" ? "commandes.closyria.com" : "commandes.dev.closyria.com";
}

export function isOrderInboxCode(code: string): boolean {
  return code.length === ORDER_INBOX_CODE_LENGTH && [...code].every((c) => ORDER_INBOX_CODE_ALPHABET.includes(c));
}

/**
 * The first-name part of an address: her first name without accents, in lowercase letters, digits and dashes
 * (« Hélène » → « helene », « Marie-Claire » → « marie-claire »), « commande » when nothing is left.
 */
export function orderInboxSlug(firstName: string | null): string {
  const first = (firstName ?? "").trim().split(/\s+/)[0] ?? "";
  const slug = first
    .replace(/[œŒ]/g, "oe")
    .replace(/[æÆ]/g, "ae")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ORDER_INBOX_SLUG)
    .replace(/-+$/, "");
  return slug || ORDER_INBOX_FALLBACK;
}

/** `{slug}-{code}`, e.g. « marie-k7f2 ». */
export function orderInboxLocalPart(firstName: string | null, code: string): string {
  if (!isOrderInboxCode(code)) throw new Error("invalid order address code");
  return `${orderInboxSlug(firstName)}-${code}`;
}

// --- Inputs ------------------------------------------------------------------------------------------------------

/** A text field she may empty: blank reads as null. */
const optionalText = (max: number) =>
  z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().trim().min(1).max(max).nullable(),
    )
    .optional();

const EARLIEST_ORDER = Date.UTC(2000, 0, 1);
/** When she ordered: from 2000 to tomorrow at most (time zones, a clock a little ahead). */
const orderedAtSchema = dateTimeSchema.refine(
  (v) => {
    const at = Date.parse(v);
    return at >= EARLIEST_ORDER && at <= Date.now() + 24 * HOUR_MS;
  },
  { message: "order date out of range" },
);

const trackingNumberSchema = z
  .string()
  .max(200)
  .transform(normalizeTrackingNumber)
  .pipe(
    z
      .string()
      .min(MIN_TRACKING_NUMBER)
      .max(MAX_TRACKING_NUMBER)
      .regex(/^[0-9A-Z]+$/),
  );

/** « Ajouter un numéro de suivi »: the carrier is guessed when not given (`detectCarrier`), and she can change it. */
export const trackingInputSchema = z.object({
  trackingNumber: trackingNumberSchema,
  carrier: carrierSchema.optional(),
});
export type TrackingInput = z.infer<typeof trackingInputSchema>;

/** One article of an order, typed or corrected by her. A price needs its currency. */
export const orderLineInputSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_ORDER_LINE_NAME),
    sizeLabel: optionalText(MAX_SIZE_LABEL),
    color: optionalText(MAX_ORDER_LINE_COLOR),
    quantity: z.number().int().min(1).max(MAX_ORDER_LINE_QUANTITY),
    priceCents: centsSchema.nullable().optional(),
    currency: currencySchema.nullable().optional(),
  })
  .refine((l) => l.priceCents == null || l.currency != null, {
    message: "currency required with a price",
    path: ["currency"],
  });
export type OrderLineInput = z.infer<typeof orderLineInputSchema>;

/** « Corriger » on an order to validate: only the fields given change; `lines` replaces them all. */
export const orderPatchSchema = z.object({
  profileId: uuidSchema.optional(),
  shopName: z.string().trim().min(1).max(MAX_SHOP_NAME).optional(),
  externalRef: optionalText(MAX_EXTERNAL_REF),
  orderedAt: orderedAtSchema.nullable().optional(),
  lines: z.array(orderLineInputSchema).min(1).max(MAX_ORDER_LINES).optional(),
});
export type OrderPatch = z.infer<typeof orderPatchSchema>;

/** Manual entry (« On n'a pas su lire cet e-mail », or typed from scratch). A carrier needs its tracking number. */
export const manualOrderInputSchema = z
  .object({
    profileId: uuidSchema,
    shopName: z.string().trim().min(1).max(MAX_SHOP_NAME),
    externalRef: optionalText(MAX_EXTERNAL_REF),
    orderedAt: orderedAtSchema.nullable().optional(),
    lines: z.array(orderLineInputSchema).min(1).max(MAX_ORDER_LINES),
    trackingNumber: trackingNumberSchema.optional(),
    carrier: carrierSchema.optional(),
    /** The unreadable e-mail this entry replaces, if any. */
    inboundEmailId: uuidSchema.optional(),
  })
  .refine((o) => o.carrier === undefined || o.trackingNumber !== undefined, {
    message: "trackingNumber required with a carrier",
    path: ["trackingNumber"],
  });
export type ManualOrderInput = z.infer<typeof manualOrderInputSchema>;

// --- Views -------------------------------------------------------------------------------------------------------

export const orderLineViewSchema = z.object({
  id: uuidSchema,
  itemId: uuidSchema.nullable(),
  productId: uuidSchema.nullable(),
  name: z.string(),
  sizeLabel: z.string().nullable(),
  color: z.string().nullable(),
  quantity: z.number().int().positive(),
  priceCents: centsSchema.nullable(),
  currency: currencySchema.nullable(),
  /** Its article's step (« Commandé »: a tracking number can still be added); null without one or in the trash. */
  itemStage: itemStageSchema.nullable(),
});
export type OrderLineView = z.infer<typeof orderLineViewSchema>;

export const parcelViewSchema = z.object({
  id: uuidSchema,
  carrier: carrierSchema.nullable(),
  trackingNumber: z.string(),
  status: parcelStatusSchema,
  lastEventAt: dateTimeSchema.nullable(),
  /** The carrier's last step (« Pris en charge », « Disponible en point relais »…). */
  lastEventLabel: z.string().nullable(),
  estimatedAt: dateTimeSchema.nullable(),
  deliveredAt: dateTimeSchema.nullable(),
});
export type ParcelView = z.infer<typeof parcelViewSchema>;

export const orderViewSchema = z.object({
  id: uuidSchema,
  profileId: uuidSchema,
  /** The shop known to Closyria; null when unknown (no site read, or a typed name that matches no shop). */
  shop: z
    .object({ id: uuidSchema, name: z.string(), returnsUrl: z.url({ protocol: /^https?$/ }).nullable() })
    .nullable(),
  /** The name to show: the shop's, else the one she typed (`orders.shop_name`), else null. */
  shopName: z.string().nullable(),
  externalRef: z.string().nullable(),
  orderedAt: dateTimeSchema.nullable(),
  status: orderStatusSchema,
  source: orderSourceSchema,
  parseMethod: orderParseMethodSchema,
  lines: z.array(orderLineViewSchema),
  parcels: z.array(parcelViewSchema),
  /**
   * « Tu as reçu ta commande {boutique} ? » waits for her answer: asked (at 10 or 20 days), not answered since, and
   * her articles still « Commandé ».
   */
  receivedQuestion: z.boolean(),
  createdAt: dateTimeSchema,
});
export type OrderView = z.infer<typeof orderViewSchema>;

/** An e-mail of hers nothing could read (« On n'a pas su lire cet e-mail »): she types the order, or sets it aside. */
export const unreadEmailViewSchema = z.object({ id: uuidSchema, receivedAt: dateTimeSchema });
export type UnreadEmailView = z.infer<typeof unreadEmailViewSchema>;

export const orderListSchema = z.object({
  orders: z.array(orderViewSchema),
  /** Her e-mails of the last 30 days nothing could read, newest first; those she typed or set aside are not listed. */
  unreadEmails: z.array(unreadEmailViewSchema),
});
export type OrderList = z.infer<typeof orderListSchema>;

/** « Mes commandes par e-mail »: her active address, null before she asked for one. */
export const orderInboxViewSchema = z.object({
  /**
   * E-mails are received in this environment (INBOUND_EMAIL_SECRET set). False: no address is given or created (an
   * address nobody reads would lose her e-mails), « Mes commandes par e-mail » says it is coming soon.
   */
  receiving: z.boolean(),
  /** Her active address; null before she asked for one, and always null while `receiving` is false. */
  address: z.email().nullable(),
  /**
   * Gmail's automatic forwarding is accepted (INBOUND_AUTOFORWARD=on): the help shows its steps. Off, only « Transférer »
   * one e-mail at a time works, and no confirmation code is shown.
   */
  autoForward: z.boolean(),
  /**
   * Gmail's forwarding confirmation code, received on her address in the last 24 hours, when the Gmail address that
   * asked is hers (she types it in Gmail's settings); null otherwise, and always null while `autoForward` is off.
   */
  pendingGmailCode: z
    .string()
    .regex(/^\d{6,12}$/)
    .nullable(),
});
export type OrderInboxView = z.infer<typeof orderInboxViewSchema>;

// --- Reading an e-mail -------------------------------------------------------------------------------------------

/** Longest product address kept from an e-mail (as `canonicalizeUrl`). */
export const MAX_PRODUCT_URL = 2048;
/** Tracking numbers kept from one e-mail at most. */
export const MAX_PARSED_TRACKING_NUMBERS = 10;

export const parsedOrderLineSchema = z.object({
  name: z.string().min(1).max(MAX_ORDER_LINE_NAME),
  sizeLabel: z.string().min(1).max(MAX_SIZE_LABEL).nullable(),
  color: z.string().min(1).max(MAX_ORDER_LINE_COLOR).nullable(),
  quantity: z.number().int().min(1).max(MAX_ORDER_LINE_QUANTITY),
  priceCents: centsSchema.nullable(),
  currency: currencySchema.nullable(),
  /**
   * The product page the e-mail links the article to (known formats only, never followed): the worker looks it up
   * among the products already known (`order_lines.product_id`), it never creates one.
   */
  productUrl: z
    .url({ protocol: /^https?$/ })
    .max(MAX_PRODUCT_URL)
    .optional(),
});
export type ParsedOrderLine = z.infer<typeof parsedOrderLineSchema>;

export const parsedTrackingSchema = z.object({
  trackingNumber: z
    .string()
    .min(MIN_TRACKING_NUMBER)
    .max(MAX_TRACKING_NUMBER)
    .regex(/^[0-9A-Z]+$/),
  carrier: carrierSchema.nullable(),
});
export type ParsedTracking = z.infer<typeof parsedTrackingSchema>;

/**
 * What an order or shipping e-mail says (known formats in `packages/extract`, the AI in `packages/ai`): only what it
 * says, every unknown field null. `shopHost` is the shop's own site when the e-mail names it (a link of its header,
 * the merchant of its structured data). At least one line, tracking number or order number, or it is no order.
 */
export const parsedOrderSchema = z
  .object({
    shopName: z.string().min(1).max(MAX_SHOP_NAME).nullable(),
    shopHost: z.string().min(1).max(253).nullable(),
    externalRef: z.string().min(1).max(MAX_EXTERNAL_REF).nullable(),
    orderedAt: dateTimeSchema.nullable(),
    lines: z.array(parsedOrderLineSchema).max(MAX_ORDER_LINES),
    trackings: z.array(parsedTrackingSchema).max(MAX_PARSED_TRACKING_NUMBERS),
  })
  .refine((o) => o.lines.length > 0 || o.trackings.length > 0 || o.externalRef !== null, {
    message: "nothing read",
  });
export type ParsedOrder = z.infer<typeof parsedOrderSchema>;

/** A reading before cleaning: any field may be missing, too long, blank or malformed. */
export type ParsedOrderDraft = {
  shopName?: string | null;
  shopHost?: string | null;
  externalRef?: string | null;
  orderedAt?: Date | string | null;
  lines?: ReadonlyArray<{
    name?: string | null;
    sizeLabel?: string | null;
    color?: string | null;
    quantity?: number | null;
    priceCents?: number | null;
    currency?: string | null;
    productUrl?: string | null;
  }>;
  trackingNumbers?: ReadonlyArray<{ number: string; carrierHint?: Carrier | null }>;
};

const squash = (v: string | null | undefined, max: number): string | null => {
  const text = (v ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max).trimEnd() : text;
};

/** An order number as shops write it (« #1042 », « FR-2026-000123 »): letters, digits and `-_/.`, no leading `#`. */
function cleanExternalRef(v: string | null | undefined): string | null {
  const ref = (v ?? "").trim().replace(/^(?:n°|no\.?|#)\s*/i, "");
  return /^[0-9A-Za-z][0-9A-Za-z\-_/.]*$/.test(ref) && ref.length <= MAX_EXTERNAL_REF ? ref : null;
}

/**
 * The cleaned reading, or null when nothing useful is left: blank and over-long texts cut or dropped, quantities
 * outside 1–99 read as 1 (a line with a quantity of 0 is not bought), a price without currency dropped, tracking
 * numbers normalised, deduplicated and their carrier guessed (`detectCarrier`, the e-mail's carrier name as hint),
 * an order date outside 2000 – tomorrow dropped.
 */
export function cleanParsedOrder(draft: ParsedOrderDraft, now: Date = new Date()): ParsedOrder | null {
  const lines: ParsedOrderLine[] = [];
  for (const line of draft.lines ?? []) {
    const name = squash(line.name, MAX_ORDER_LINE_NAME);
    if (!name || lines.length >= MAX_ORDER_LINES) continue;
    const q = line.quantity;
    const quantity = typeof q === "number" && Number.isInteger(q) && q >= 1 && q <= MAX_ORDER_LINE_QUANTITY ? q : 1;
    const currency = line.currency && /^[A-Z]{3}$/.test(line.currency) ? line.currency : null;
    const price = line.priceCents;
    const priceOk = typeof price === "number" && centsSchema.safeParse(price).success && currency !== null;
    const productUrl = parsedOrderLineSchema.shape.productUrl.safeParse(line.productUrl ?? undefined);
    lines.push({
      name,
      sizeLabel: squash(line.sizeLabel, MAX_SIZE_LABEL),
      color: squash(line.color, MAX_ORDER_LINE_COLOR),
      quantity,
      priceCents: priceOk ? price : null,
      currency: priceOk ? currency : null,
      ...(productUrl.success && productUrl.data ? { productUrl: productUrl.data } : {}),
    });
  }
  const trackings: ParsedTracking[] = [];
  for (const t of draft.trackingNumbers ?? []) {
    const trackingNumber = normalizeTrackingNumber(t.number);
    if (!parsedTrackingSchema.shape.trackingNumber.safeParse(trackingNumber).success) continue;
    if (trackings.some((k) => k.trackingNumber === trackingNumber)) continue;
    if (trackings.length >= MAX_PARSED_TRACKING_NUMBERS) break;
    trackings.push({ trackingNumber, carrier: detectCarrier(trackingNumber, t.carrierHint ?? null) });
  }
  let orderedAt: string | null = null;
  if (draft.orderedAt) {
    const at = draft.orderedAt instanceof Date ? draft.orderedAt : new Date(draft.orderedAt);
    const ms = at.getTime();
    if (Number.isFinite(ms) && ms >= EARLIEST_ORDER && ms <= now.getTime() + 24 * HOUR_MS) orderedAt = at.toISOString();
  }
  const host = (draft.shopHost ?? "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  const parsed = {
    shopName: squash(draft.shopName, MAX_SHOP_NAME),
    shopHost: /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) && host.length <= 253 ? host : null,
    externalRef: cleanExternalRef(draft.externalRef),
    orderedAt,
    lines,
    trackings,
  };
  const result = parsedOrderSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

/** Carrier names as e-mails write them, most specific first (« Chronopost » before « La Poste »). */
const CARRIER_NAMES: ReadonlyArray<readonly [RegExp, Carrier]> = [
  [/\bchronopost\b/i, "chronopost"],
  [/\bcolissimo\b/i, "colissimo"],
  [/\blettre\s+suivie\b/i, "lettre_suivie"],
  [/\bmondial\s*relay\b/i, "mondial_relay"],
  [/\bcolis\s*priv[ée](?!\p{L})/iu, "colis_prive"],
  [/\bgls\b/i, "gls"],
  [/\bdpd\b/i, "dpd"],
  [/\bups\b/i, "ups"],
  [/\bdhl\b/i, "dhl"],
];

/** The carrier a text names (« Expédié avec Mondial Relay »), the first one found; null when none. */
export function carrierFromName(text: string | null | undefined): Carrier | null {
  if (!text) return null;
  return CARRIER_NAMES.find(([re]) => re.test(text))?.[1] ?? null;
}

// --- Instagram (C5) ----------------------------------------------------------------------------------------------

/** `POST /api/captures` with an Instagram link: nothing is read, the client shows the short form for this link. */
export const instagramCaptureSchema = z.object({ form: z.literal("instagram"), url: z.string() });
export type InstagramCapture = z.infer<typeof instagramCaptureSchema>;

export const MAX_ITEM_NAME = 300;
export const MAX_ITEM_BRAND = 120;
export const MAX_SOURCE_URL = 2048;

/**
 * The short form of an Instagram link (`POST /api/me/items/instagram`): an article without a product, her name for it
 * and the shop or brand she saw, the link kept as its source. `wish` (« Repéré ») or `ordered` (« Commandé »); what she
 * paid (`priceCents`, euros) only for an ordered one.
 */
export const instagramItemInputSchema = z
  .object({
    url: z.string().trim().max(MAX_SOURCE_URL).refine(isInstagramUrl, { message: "not an Instagram link" }),
    action: z.enum(["wish", "ordered"]),
    profileId: uuidSchema.optional(),
    name: z.string().trim().min(1).max(MAX_ITEM_NAME),
    brand: optionalText(MAX_ITEM_BRAND),
    priceCents: centsSchema.nullable().optional(),
    sizeLabel: optionalText(MAX_SIZE_LABEL),
    notes: optionalText(MAX_NOTES),
  })
  .refine((v) => v.action === "ordered" || v.priceCents == null, {
    message: "a price only for an ordered article",
    path: ["priceCents"],
  });
export type InstagramItemInput = z.infer<typeof instagramItemInputSchema>;

// --- Screens (Task 7) --------------------------------------------------------------------------------------------

/** « Mes commandes »: her orders to validate and her orders. */
export const ORDERS_PAGE_HREF = "/mes-commandes";

/** One order on « Mes commandes » (where its notifications lead). */
export const orderHref = (orderId: string) => `${ORDERS_PAGE_HREF}#commande-${orderId}`;

/** The sheet of an article without a product (born from an order line or an Instagram link). */
export const bareItemHref = (itemId: string) => `/articles/${itemId}`;

/**
 * « Suivre chez le transporteur » (RF 4): the carrier's own tracking page for the number; for a carrier not known, a
 * tracking search on every carrier.
 */
export function carrierTrackingUrl(carrier: Carrier | null, trackingNumber: string): string {
  const n = encodeURIComponent(trackingNumber);
  switch (carrier) {
    case "colissimo":
    case "lettre_suivie":
      return `https://www.laposte.fr/outils/suivre-vos-envois?code=${n}`;
    case "chronopost":
      return `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${n}`;
    case "mondial_relay":
      return `https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition=${n}`;
    case "gls":
      return `https://gls-group.com/FR/fr/suivi-colis?match=${n}`;
    case "dpd":
      return `https://trace.dpd.fr/fr/trace/${n}`;
    case "colis_prive":
      return `https://www.colisprive.com/moncolis/pages/detailColis.aspx?numColis=${n}`;
    case "ups":
      return `https://www.ups.com/track?loc=fr_FR&tracknum=${n}`;
    case "dhl":
      return `https://www.dhl.com/fr-fr/home/suivi.html?tracking-id=${n}`;
    case null:
      return `https://t.17track.net/fr#nums=${n}`;
  }
}

/**
 * « Changer de transporteur » on one of her parcels (`PATCH /api/me/orders/{id}/parcels/{parcelId}`): the tracking
 * starts again with that carrier (step `pending`, no failure counted, next check at the usual rhythm).
 */
export const parcelCarrierInputSchema = z.object({ carrier: carrierSchema });
export type ParcelCarrierInput = z.infer<typeof parcelCarrierInputSchema>;
