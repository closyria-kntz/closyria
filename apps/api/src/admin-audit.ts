import type { AuditDetails, Database } from "@closyria/db";
import { schema } from "@closyria/db";
import type { Context } from "hono";
import { type AccessEnv, appWide } from "./access";

/** What an admin handler says about the action it performed. Never copy a request body in here. */
export type AuditNote = {
  /** Stable name of the action, e.g. `shop.merge`. Default: the method and the route pattern. */
  action?: string;
  /** What was acted on, e.g. `user:<id>`. */
  target?: string;
  details?: AuditDetails;
};

/** Hono environment of admin routes: the access variables plus the handler's audit note. */
export type AdminEnv = AccessEnv & { Variables: { audit?: AuditNote } };

const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Lets an admin handler describe what it did; read by `auditMiddleware` once the handler returns. */
export function noteAudit(c: Context<AdminEnv>, note: AuditNote): void {
  c.set("audit", note);
}

/**
 * Journals every admin action (spec §8). Registered app-wide (`app.use("*", …)`), it writes one
 * `admin_audit_log` row after each POST, PUT, PATCH or DELETE that reached a route declared `admin`
 * (access granted), whatever the response status. A refused request is not an admin action and is not
 * recorded. Only the handler's note, the method, the path and the status are stored: never the body,
 * nor the query string, which may hold a user's data.
 */
export function auditMiddleware(db: Database) {
  return appWide<AdminEnv>(async (c, next) => {
    await next();
    const access = c.get("access");
    if (access?.level !== "admin" || !MUTATIONS.has(c.req.method)) return;
    const adminId = c.get("session")?.user.id ?? null;
    const note = c.get("audit");
    const details = { ...note?.details, method: c.req.method, path: c.req.path, status: c.res.status };
    // A failed write fails the request: an admin action must not go unrecorded silently.
    await db.insert(schema.adminAuditLog).values({
      adminId,
      action: note?.action ?? `${c.req.method} ${access.route}`,
      target: note?.target ?? null,
      details,
    });
  });
}
