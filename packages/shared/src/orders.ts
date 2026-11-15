import { z } from "zod";
import { parisDay } from "./alerts";
import { currencySchema } from "./catalog";
import { MAX_SIZE_LABEL } from "./wardrobe";

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

// --- Order addresses and received e-mails ------------------------------------------------------------------------

/** Largest e-mail received (the raw message, headers included); a larger one is refused, nothing stored. */
export const INBOUND_EMAIL_MAX_BYTES = 2 * 1024 * 1024;
/** E-mails stored per address and per 24 hours at most (a flood of forged ones fills nothing). */
export const MAX_INBOUND_EMAILS_PER_DAY = 100;
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
  shop: z
    .object({ id: uuidSchema, name: z.string(), returnsUrl: z.url({ protocol: /^https?$/ }).nullable() })
    .nullable(),
  externalRef: z.string().nullable(),
  orderedAt: dateTimeSchema.nullable(),
  status: orderStatusSchema,
  source: orderSourceSchema,
  parseMethod: orderParseMethodSchema,
  lines: z.array(orderLineViewSchema),
  parcels: z.array(parcelViewSchema),
  createdAt: dateTimeSchema,
});
export type OrderView = z.infer<typeof orderViewSchema>;

export const orderListSchema = z.object({ orders: z.array(orderViewSchema) });
export type OrderList = z.infer<typeof orderListSchema>;

/** « Mes commandes par e-mail »: her active address, null before she asked for one. */
export const orderInboxViewSchema = z.object({ address: z.email().nullable() });
export type OrderInboxView = z.infer<typeof orderInboxViewSchema>;
