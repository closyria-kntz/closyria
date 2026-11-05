import { z } from "zod";
import {
  captureErrorCodeSchema,
  captureMethodSchema,
  captureModeSchema,
  captureStatusSchema,
  captureTriggerSchema,
  listingKindSchema,
  platformSchema,
  shopStatusSchema,
} from "./catalog";
import { canonicalizeUrl } from "./catalog-url";

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
});

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
  })
  .partial();

export const adminShopCreateSchema = z.object({ url: z.string().max(2048) });
export const adminShopCreatedSchema = z.object({ shopId: z.uuid(), captureId: z.uuid() });
export const adminMergeSchema = z.object({ targetId: z.uuid() });
export const adminMergedSchema = z.object({ targetId: z.uuid() });

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
