import { z } from "zod";
import {
  captureErrorCodeSchema,
  captureMethodSchema,
  captureModeSchema,
  captureStatusSchema,
  captureTriggerSchema,
  listingKindSchema,
  platformSchema,
  productCaptureStatusSchema,
  shopStatusSchema,
} from "./catalog";
import { canonicalizeUrl } from "./catalog-url";
import { importStateSchema, reportReasonSchema, shopValueSchema } from "./catalogue";
import { audienceSchema, childDetailSchema, classifiedBySchema, seasonSchema } from "./wardrobe";

const count = z.number().int().nonnegative();

/** Answer of `GET /api/admin/overview`. "Today" is the current UTC day. */
export const adminOverviewSchema = z.object({
  users: z.object({ total: count, anonymous: count, registered: count }),
  /** Audience events that occurred today. */
  eventsToday: count,
  /** Accounts (not anonymous) created today. */
  signupsToday: count,
  /** Captures created over the last 24 hours / 7 days; rates and durations cover finished captures (succeeded or failed). */
  captures: z.object({
    last24h: count,
    last7d: count,
    /** Succeeded / finished captures over 7 days; null when none finished. */
    successRate7d: z.number().min(0).max(1).nullable(),
    /** Succeeded captures per method over 7 days. */
    byMethod: z.object({ shopify: count, jsonld: count, opengraph: count }),
    /** Median duration of the succeeded captures over 7 days; null when none. */
    medianDurationMs: z.number().nonnegative().nullable(),
  }),
  shops: z.object({ pending: count, down: count }),
});
export type AdminOverview = z.infer<typeof adminOverviewSchema>;

/** Number of entries per page of `GET /api/admin/audit`. */
export const ADMIN_AUDIT_PAGE_SIZE = 50;

export const adminAuditEntrySchema = z.object({
  id: z.uuid(),
  /** Null once the admin's account is deleted. */
  adminId: z.string().nullable(),
  adminEmail: z.string().nullable(),
  action: z.string(),
  target: z.string().nullable(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  createdAt: z.iso.datetime(),
});
export type AdminAuditEntry = z.infer<typeof adminAuditEntrySchema>;

/** A page of the audit log, newest first. `nextCursor` is opaque; null on the last page. */
export const adminAuditPageSchema = z.object({
  entries: z.array(adminAuditEntrySchema),
  nextCursor: z.string().nullable(),
});
export type AdminAuditPage = z.infer<typeof adminAuditPageSchema>;

export const adminErrorSchema = z.object({ error: z.literal("invalid_cursor") });

/**
 * What the admin area reads from Better Auth's `GET /api/auth/get-session` (null without a session).
 * Only the fields that decide access; everything else is ignored.
 */
export const adminSessionSchema = z
  .object({
    user: z.object({ role: z.string() }),
    session: z.object({ authMethod: z.string() }),
  })
  .nullable();
export type AdminSession = z.infer<typeof adminSessionSchema>;

export const shopHealthSchema = z.enum(["ok", "degraded", "down", "not_applicable"]);
export type ShopHealth = z.infer<typeof shopHealthSchema>;

export const adminCatalogErrorSchema = z.object({
  error: z.enum([
    "invalid_request",
    "invalid_url",
    "not_found",
    "domain_taken",
    "slug_taken",
    "invalid_merge",
    "capture_active",
    "kept",
    "cycle",
    "has_children",
    "not_published",
    "not_shopify",
    "merged",
    "refused",
  ]),
  /** With `domain_taken` on shop creation: the shop that owns the domain. */
  shopId: z.uuid().optional(),
});

const isoDate = z.iso.datetime();

export const adminShopLastCaptureSchema = z.object({
  id: z.uuid(),
  status: captureStatusSchema,
  trigger: captureTriggerSchema,
  errorCode: captureErrorCodeSchema.nullable(),
  createdAt: isoDate,
});

export const adminShopSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  status: shopStatusSchema,
  platform: platformSchema,
  captureMode: captureModeSchema,
  listingKind: listingKindSchema,
  testUrl: z.string().nullable(),
  domains: z.array(z.string()),
  health: shopHealthSchema,
  /** Ticked by the admin: filters of « Découvrir ». */
  values: z.array(shopValueSchema),
  /** « Importer tout le catalogue » (Shopify): the nightly import is on. */
  importEnabled: z.boolean(),
  lastImportAt: isoDate.nullable(),
  /** Code of the last import's failure (`blocked (HTTP 429)`, `robots_disallowed`…); null after a full import. */
  lastImportError: z.string().nullable(),
  /** « En attente » / « Import en cours »; null when none is under way (or its job died: over 6 h). */
  importState: importStateSchema.nullable(),
  /** When it was queued, then started. */
  importStartedAt: isoDate.nullable(),
  /** Pages and articles read by the import under way (reset when the worker starts it). */
  importPages: count,
  importSeen: count,
  /** Articles read, new and removed by the last complete import (« Terminé à … »); null before the first one. */
  lastImportSeen: count.nullable(),
  lastImportCreated: count.nullable(),
  lastImportRemoved: count.nullable(),
  createdAt: isoDate,
});
export type AdminShop = z.infer<typeof adminShopSchema>;

export const adminShopListItemSchema = adminShopSchema.extend({
  /** Products created over the last 30 days. */
  recentProducts: count,
  lastCapture: adminShopLastCaptureSchema.nullable(),
});
export const adminShopListSchema = z.object({ shops: z.array(adminShopListItemSchema) });

export const adminShopErrorSchema = z.object({
  errorCode: captureErrorCodeSchema.nullable(),
  httpStatus: z.number().int().nullable(),
  url: z.string(),
  createdAt: isoDate,
});

export const adminShopDetailSchema = adminShopSchema.extend({
  successRate7d: z.number().min(0).max(1).nullable(),
  /** Latest finished monitor captures, most recent first. */
  lastMonitors: z.array(z.boolean()),
  lastMonitor: adminShopLastCaptureSchema.nullable(),
  recentErrors: z.array(adminShopErrorSchema),
  /** It is the « boutique de la semaine » of « Découvrir » right now (the published shop featured most recently). */
  featured: z.boolean(),
  /** Products of the shop still on sale (not removed by the last import). */
  catalogueProducts: count,
});
export type AdminShopDetail = z.infer<typeof adminShopDetailSchema>;

/** Only the import fields of the shop page's panel: read every 3 s while an import runs (same definitions as the detail). */
export const adminShopImportStatusSchema = adminShopSchema.pick({
  importState: true,
  importStartedAt: true,
  importPages: true,
  importSeen: true,
  lastImportAt: true,
  lastImportError: true,
  lastImportSeen: true,
  lastImportCreated: true,
  lastImportRemoved: true,
});
export type AdminShopImportStatus = z.infer<typeof adminShopImportStatusSchema>;

const slugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9-]+$/);

export const adminShopPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    slug: slugSchema,
    status: shopStatusSchema,
    captureMode: captureModeSchema,
    listingKind: listingKindSchema,
    testUrl: z
      .string()
      .max(2048)
      .refine((v) => canonicalizeUrl(v) !== null)
      .nullable(),
    domains: z.array(z.string().trim().min(1).max(253)).min(1).max(50),
    /** Replaces the whole set; duplicates are dropped. */
    values: z
      .array(shopValueSchema)
      .max(10)
      .transform((list) => [...new Set(list)]),
    importEnabled: z.boolean(),
  })
  .partial();

export const adminShopCreateSchema = z.object({ url: z.string().max(2048) });
export const adminShopCreatedSchema = z.object({ shopId: z.uuid(), captureId: z.uuid() });
export const adminMergeSchema = z.object({ targetId: z.uuid() });
export const adminMergedSchema = z.object({ targetId: z.uuid() });

/** Answer of `POST /api/admin/shops/{id}/import`: false when an import of the shop is already queued or running. */
export const adminImportQueuedSchema = z.object({ queued: z.boolean() });

export const adminCaptureTestSchema = z.object({ url: z.string().max(2048) });
export const adminCaptureAcceptedSchema = z.object({ captureId: z.uuid(), shopId: z.uuid() });

export const adminCaptureSchema = z.object({
  id: z.uuid(),
  shopId: z.uuid(),
  productId: z.uuid().nullable(),
  url: z.string(),
  trigger: captureTriggerSchema,
  status: captureStatusSchema,
  method: captureMethodSchema.nullable(),
  durationMs: z.number().int().nullable(),
  errorCode: captureErrorCodeSchema.nullable(),
  httpStatus: z.number().int().nullable(),
  result: z.unknown().nullable(),
  createdAt: isoDate,
  finishedAt: isoDate.nullable(),
});

export type AdminCapture = z.infer<typeof adminCaptureSchema>;

export const adminCaptureFailureSchema = z.object({
  id: z.uuid(),
  shopId: z.uuid(),
  shopName: z.string(),
  productId: z.uuid().nullable(),
  url: z.string(),
  trigger: captureTriggerSchema,
  errorCode: captureErrorCodeSchema.nullable(),
  httpStatus: z.number().int().nullable(),
  createdAt: isoDate,
});
export const adminCaptureFailuresSchema = z.object({ failures: z.array(adminCaptureFailureSchema) });
export const ADMIN_FAILURES_LIMIT = 100;

// ---- Product sheets and reference lists (chantier 2a, admin) ----

/** Number of products per page of `GET /api/admin/products`. */
export const ADMIN_PRODUCTS_PAGE_SIZE = 50;
export const adminClassifiedFilterSchema = z.enum(["rule", "admin", "none"]);
/** « Masqués »: the sheets an admin hid from « Découvrir » (to put them back). */
export const adminCatalogueFilterSchema = z.enum(["hidden"]);

export const adminProductsQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  shopId: z.uuid().optional(),
  captureStatus: productCaptureStatusSchema.optional(),
  classified: adminClassifiedFilterSchema.optional(),
  catalogue: adminCatalogueFilterSchema.optional(),
  cursor: z.string().min(1).max(200).optional(),
});

const adminProductBase = z.object({
  id: z.uuid(),
  shopId: z.uuid(),
  shopName: z.string(),
  name: z.string().nullable(),
  brand: z.string().nullable(),
  currency: z.string().nullable(),
  priceCents: z.number().int().nullable(),
  captureStatus: productCaptureStatusSchema,
  classifiedBy: classifiedBySchema,
  categoryId: z.uuid().nullable(),
  /** Number of active wardrobe items kept from this sheet; never who. */
  keptBy: count,
  createdAt: isoDate,
});

export const adminProductListItemSchema = adminProductBase.extend({ imageUrl: z.string().nullable() });
export const adminProductListSchema = z.object({
  products: z.array(adminProductListItemSchema),
  nextCursor: z.string().nullable(),
});
export type AdminProductList = z.infer<typeof adminProductListSchema>;

export const adminProductDetailSchema = adminProductBase.extend({
  canonicalUrl: z.string(),
  externalId: z.string().nullable(),
  description: z.string().nullable(),
  compareAtCents: z.number().int().nullable(),
  source: z.string(),
  gtin: z.string().nullable(),
  sku: z.string().nullable(),
  shopData: z.record(z.string(), z.unknown()),
  audience: audienceSchema.nullable(),
  childDetail: childDetailSchema.nullable(),
  colorId: z.uuid().nullable(),
  materialId: z.uuid().nullable(),
  patternId: z.uuid().nullable(),
  season: seasonSchema.nullable(),
  publishedAt: isoDate.nullable(),
  lastCapturedAt: isoDate.nullable(),
  updatedAt: isoDate,
  /** When an admin hid it from « Découvrir » (« Masquer du catalogue »); null when it is not hidden. */
  hiddenAt: isoDate.nullable(),
  images: z.array(z.object({ id: z.uuid(), url: z.string(), width: z.number().int(), height: z.number().int() })),
  sizes: z.array(z.object({ label: z.string(), available: z.boolean(), priceCents: z.number().int().nullable() })),
});
export type AdminProductDetail = z.infer<typeof adminProductDetailSchema>;

/** Fields an admin corrects; any key sets `classified_by` to `admin`. */
export const adminProductPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(300),
    brand: z.string().trim().min(1).max(120).nullable(),
    priceCents: z.number().int().min(0).max(100_000_000).nullable(),
    audience: audienceSchema.nullable(),
    childDetail: childDetailSchema.nullable(),
    categoryId: z.uuid().nullable(),
    colorId: z.uuid().nullable(),
    materialId: z.uuid().nullable(),
    patternId: z.uuid().nullable(),
    season: seasonSchema.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0);
export type AdminProductPatch = z.infer<typeof adminProductPatchSchema>;

export const adminRecaptureSchema = z.object({ captureId: z.uuid() });

export const referenceKindSchema = z.enum(["categories", "colors", "materials", "patterns"]);
export type ReferenceKind = z.infer<typeof referenceKindSchema>;

export const MAX_KEYWORDS = 100;
export const MAX_KEYWORD_LENGTH = 60;
const keywordsSchema = z
  .array(z.string().trim().min(1).max(MAX_KEYWORD_LENGTH))
  .max(MAX_KEYWORDS)
  .transform((list) => {
    const seen = new Set<string>();
    return list.filter((k) => {
      const key = k.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
const refSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const refName = z.string().trim().min(1).max(80);
const hexSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

const entryFields = { slug: refSlugSchema, name: refName };
const createFields = { ...entryFields, keywords: keywordsSchema.default([]) };
const patchFields = { ...entryFields, keywords: keywordsSchema };
export const referenceCreateSchemas = {
  categories: z.object({
    ...createFields,
    parentId: z.uuid().nullable().default(null),
    position: z.number().int().min(0).max(100_000).default(0),
  }),
  colors: z.object({ ...createFields, hex: hexSchema }),
  materials: z.object(createFields),
  patterns: z.object(createFields),
} as const;
export const referencePatchSchemas = {
  categories: z
    .object({
      slug: refSlugSchema,
      name: refName,
      keywords: keywordsSchema,
      parentId: z.uuid().nullable(),
      position: z.number().int().min(0).max(100_000),
    })
    .partial()
    .refine((v) => Object.keys(v).length > 0),
  colors: z
    .object({ ...patchFields, hex: hexSchema })
    .partial()
    .refine((v) => Object.keys(v).length > 0),
  materials: z
    .object(patchFields)
    .partial()
    .refine((v) => Object.keys(v).length > 0),
  patterns: z
    .object(patchFields)
    .partial()
    .refine((v) => Object.keys(v).length > 0),
} as const;

export const referenceEntrySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  keywords: z.array(z.string()),
  /** Categories only. */
  parentId: z.uuid().nullable().optional(),
  position: z.number().int().optional(),
  /** Colours only. */
  hex: z.string().optional(),
});
export type ReferenceEntry = z.infer<typeof referenceEntrySchema>;
export const referenceListSchema = z.object({ entries: z.array(referenceEntrySchema) });
export const referenceDeletedSchema = z.object({ deleted: z.literal(true) });

// ---- Catalogue « Découvrir » (admin): « À classer » and « Signalements » ----

/** At most this many articles in « À classer » (the oldest wait for the next visit). */
export const ADMIN_UNCLASSIFIED_LIMIT = 100;

export const adminUnclassifiedProductSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  shopId: z.uuid(),
  shopName: z.string(),
  imageUrl: z.string().nullable(),
  /** The shop's product type (Shopify `product_type`), as read; what « même type » compares. */
  productType: z.string().nullable(),
  categoryId: z.uuid().nullable(),
  colorId: z.uuid().nullable(),
  createdAt: isoDate,
});
export type AdminUnclassifiedProduct = z.infer<typeof adminUnclassifiedProductSchema>;
export const adminUnclassifiedListSchema = z.object({
  products: z.array(adminUnclassifiedProductSchema),
  /** Every article to file, the listed ones included. */
  total: count,
});
export type AdminUnclassifiedList = z.infer<typeof adminUnclassifiedListSchema>;

export const adminClassificationSchema = z.object({
  categoryId: z.uuid(),
  colorId: z.uuid(),
  /** Also file the shop's articles of the same product type, except those an admin already filed. */
  applyToShopType: z.boolean().optional(),
});
export type AdminClassification = z.infer<typeof adminClassificationSchema>;
export const adminClassifiedSchema = z.object({ updated: count });

export const adminReportSchema = z.object({
  productId: z.uuid(),
  name: z.string().nullable(),
  shopId: z.uuid(),
  shopName: z.string(),
  imageUrl: z.string().nullable(),
  /** Open reports of the article; who reported is never returned. */
  count,
  reasons: z.array(z.object({ reason: reportReasonSchema, count })),
  latestAt: isoDate,
});
export type AdminReport = z.infer<typeof adminReportSchema>;
export const adminReportListSchema = z.object({ reports: z.array(adminReportSchema) });
export const adminReportsResolvedSchema = z.object({ resolved: count });
