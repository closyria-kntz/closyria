import { z } from "zod";

export const shopStatusSchema = z.enum(["pending", "draft", "published"]);
export const captureModeSchema = z.enum(["auto", "manual"]);
export const listingKindSchema = z.enum(["catalog", "secondhand"]);
export const platformSchema = z.enum(["shopify", "other", "unknown"]);
export const captureTriggerSchema = z.enum(["user", "admin_test", "monitor"]);
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

const currencySchema = z.string().length(3);
const priceSchema = z.number().int().nonnegative();
const sizeSchema = z.object({
  label: z.string().min(1).max(40),
  available: z.boolean(),
  priceCents: priceSchema.optional(),
});

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
});
export type ExtractedProduct = z.infer<typeof extractedProductSchema>;

/** A product as the API shows it. */
export const productViewSchema = z.object({
  id: z.uuid(),
  shop: z.object({ name: z.string(), slug: z.string() }),
  canonicalUrl: z.string(),
  name: z.string().nullable(),
  brand: z.string().nullable(),
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
});
export type ProductView = z.infer<typeof productViewSchema>;

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
