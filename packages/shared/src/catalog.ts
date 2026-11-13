import { z } from "zod";

export const audienceSchema = z.enum(["women", "men", "child", "mixed"]);
export const childDetailSchema = z.enum(["girl", "boy", "baby"]);
export const seasonSchema = z.enum(["summer", "winter", "mid", "all"]);
/** `pending` (« À valider »): a shop found through a link; `refused`: never in the catalogue, its products kept. */
export const shopStatusSchema = z.enum(["pending", "draft", "published", "refused"]);
export const captureModeSchema = z.enum(["auto", "manual"]);
export const listingKindSchema = z.enum(["catalog", "secondhand"]);
export const platformSchema = z.enum(["shopify", "other", "unknown"]);
/** `refresh`: the live check of a catalogue sheet (« stocks frais »), asked by nobody in particular. */
export const captureTriggerSchema = z.enum(["user", "admin_test", "monitor", "refresh"]);
export const captureStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "skipped_manual"]);
export const captureMethodSchema = z.enum(["shopify", "jsonld", "opengraph"]);
export const captureErrorCodeSchema = z.enum([
  "blocked",
  "timeout",
  "too_large",
  "forbidden_address",
  "robots_disallowed",
  "not_a_product",
  "http_error",
  "invalid_data",
  "queue_unavailable",
]);
export type ShopStatus = z.infer<typeof shopStatusSchema>;
export type CaptureMode = z.infer<typeof captureModeSchema>;
export type ListingKind = z.infer<typeof listingKindSchema>;
export type Platform = z.infer<typeof platformSchema>;
export type CaptureTrigger = z.infer<typeof captureTriggerSchema>;
export type CaptureStatus = z.infer<typeof captureStatusSchema>;
export type CaptureMethod = z.infer<typeof captureMethodSchema>;
export type CaptureErrorCode = z.infer<typeof captureErrorCodeSchema>;

export const productSourceSchema = z.enum(["captured", "manual"]);
export type ProductSource = z.infer<typeof productSourceSchema>;

export const productCaptureStatusSchema = z.enum(["pending", "ok", "failed", "manual"]);
export type ProductCaptureStatus = z.infer<typeof productCaptureStatusSchema>;

export const MAX_PRODUCT_IMAGES = 8;

export const currencySchema = z.string().length(3);
const priceSchema = z.number().int().nonnegative();
const sizeSchema = z.object({
  label: z.string().min(1).max(40),
  available: z.boolean(),
  priceCents: priceSchema.optional(),
});

const shopText = z.string().max(200);
/** Raw shop data read from the page (not interpreted): strings ≤ 200 characters, lists ≤ 20 items. */
export const shopDataSchema = z.object({
  category: shopText.optional(),
  breadcrumb: z.array(shopText).max(20).optional(),
  gtins: z.array(z.string().max(14)).max(20).optional(),
  tags: z.array(shopText).max(20).optional(),
  colors: z.array(shopText).max(20).optional(),
  material: shopText.optional(),
  care: shopText.optional(),
  collection: shopText.optional(),
  /** The shop's own attributes table (WooCommerce « Caractéristiques »), as shown there: ≤ 20 rows. */
  details: z
    .array(z.object({ label: z.string().min(1).max(80), value: z.string().min(1).max(500) }))
    .max(20)
    .optional(),
});
export type ShopData = z.infer<typeof shopDataSchema>;

/** What the worker extracts from a product page. */
export const extractedProductSchema = z.object({
  name: z.string().min(1).max(300),
  brand: z.string().max(120).optional(),
  description: z.string().max(5000).optional(),
  currency: currencySchema,
  priceCents: priceSchema,
  compareAtCents: priceSchema.optional(),
  images: z.array(z.string()).max(MAX_PRODUCT_IMAGES),
  sizes: z.array(sizeSchema),
  externalId: z.string().optional(),
  siteName: z.string().optional(),
  platform: z.enum(["shopify", "other"]),
  publishedAt: z.iso.datetime().optional(),
  gtin: z
    .string()
    .regex(/^(\d{8}|\d{12,14})$/)
    .optional(),
  sku: z.string().max(200).optional(),
  shopData: shopDataSchema.optional(),
});
export type ExtractedProduct = z.infer<typeof extractedProductSchema>;

/**
 * What the sheet says the product is (filled by the worker's rules or corrected in the admin), with the labels
 * already resolved. `category` is the path from the root (« Femme », « Hauts », « Chemises »), empty when unknown.
 */
export const productTraitsSchema = z.object({
  category: z.array(z.string()),
  color: z.object({ name: z.string(), hex: z.string() }).nullable(),
  material: z.string().nullable(),
  pattern: z.string().nullable(),
  season: seasonSchema.nullable(),
  audience: audienceSchema.nullable(),
  childDetail: childDetailSchema.nullable(),
});
export type ProductTraits = z.infer<typeof productTraitsSchema>;

/** A product as the API shows it. */
export const productViewSchema = z.object({
  id: z.uuid(),
  shop: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }),
  canonicalUrl: z.string(),
  name: z.string().nullable(),
  brand: z.string().nullable(),
  /** Plain text from the shop, line breaks kept. */
  description: z.string().nullable(),
  currency: currencySchema.nullable(),
  priceCents: priceSchema.nullable(),
  compareAtCents: priceSchema.nullable(),
  sizes: z.array(sizeSchema),
  images: z.array(
    z.object({
      id: z.uuid(),
      url: z.string(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
  ),
  source: productSourceSchema,
  captureStatus: productCaptureStatusSchema,
  lastCapturedAt: z.string().nullable(),
  /** When the sheet last changed: for a hand-filled sheet, when it was filled. */
  updatedAt: z.string(),
  traits: productTraitsSchema,
  /** The shop's own attributes table (« Taille », « Composition »…), empty when the page has none. */
  details: z.array(z.object({ label: z.string(), value: z.string() })),
});
export type ProductView = z.infer<typeof productViewSchema>;

/** A product's price over time, one point per day at most. */
export const priceHistorySchema = z.object({
  points: z.array(z.object({ at: z.string(), priceCents: z.number().int().nonnegative() })),
  lowestSinceDays: z.number().int().nonnegative().nullable(),
  dropCents: z.number().int().negative().nullable(),
  dropSince: z.string().nullable(),
});
export type PriceHistory = z.infer<typeof priceHistorySchema>;

export const captureViewSchema = z.object({
  id: z.uuid(),
  status: captureStatusSchema,
  dataReady: z.boolean(),
  errorCode: captureErrorCodeSchema.nullable(),
  product: productViewSchema.nullable(),
});
export type CaptureView = z.infer<typeof captureViewSchema>;

/** Manual entry when a product cannot be captured automatically. */
export const manualEntrySchema = z.object({
  name: z.string().min(1).max(300),
  priceCents: priceSchema.optional(),
  sizes: z.array(z.string().min(1).max(40)).max(30),
});
export type ManualEntry = z.infer<typeof manualEntrySchema>;

export const CAPTURE_QUEUES = {
  user: "capture-user",
  admin: "capture-admin",
  monitor: "capture-monitor",
} as const;

/** Data of a capture job on the pg-boss queues. */
export const captureJobSchema = z.object({ captureId: z.uuid() });
export type CaptureJob = z.infer<typeof captureJobSchema>;

/** 202 body of `POST /api/captures`. */
export const captureAcceptedSchema = z.object({
  productId: z.uuid(),
  captureId: z.uuid(),
  status: captureStatusSchema,
});
export type CaptureAccepted = z.infer<typeof captureAcceptedSchema>;

/** Error bodies of the capture, product and catalog image routes. */
export const catalogErrorSchema = z.object({
  error: z.enum(["invalid_url", "invalid_request", "rate_limited", "not_found"]),
});
export type CatalogError = z.infer<typeof catalogErrorSchema>;
