import { z } from "zod";

const count = z.number().int().nonnegative();

/** Answer of `GET /api/admin/overview`. "Today" is the current UTC day. */
export const adminOverviewSchema = z.object({
  users: z.object({ total: count, anonymous: count, registered: count }),
  /** Audience events that occurred today. */
  eventsToday: count,
  /** Accounts (not anonymous) created today. */
  signupsToday: count,
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
