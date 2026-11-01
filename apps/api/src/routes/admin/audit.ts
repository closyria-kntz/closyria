import { eq, schema, sql } from "@closyria/db";
import { ADMIN_AUDIT_PAGE_SIZE, adminAuditPageSchema, adminErrorSchema } from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { defineAccess } from "../../access";
import type { AdminEnv } from "../../admin-audit";
import type { AdminDeps } from "./overview";

type Position = { createdAt: Date; id: string };

const positionSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });

/** Opaque keyset cursor: the (created_at, id) of the last entry of the page. */
export function encodeCursor(position: Position): string {
  return Buffer.from(`${position.createdAt.toISOString()}|${position.id}`).toString("base64url");
}

/** The position in a cursor, or null when it is not one this API produced. */
export function decodeCursor(cursor: string): Position | null {
  const [createdAt, id, ...rest] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const parsed = positionSchema.safeParse({ createdAt, id });
  if (rest.length > 0 || !parsed.success) return null;
  return { createdAt: new Date(parsed.data.createdAt), id: parsed.data.id };
}

const invalidCursor = { error: "invalid_cursor" } as const;

const auditRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/admin/audit",
    summary: "Admin audit log",
    description: `Admin actions, newest first, ${ADMIN_AUDIT_PAGE_SIZE} per page. Pass \`nextCursor\` as \`cursor\` for the next page.`,
    request: { query: z.object({ cursor: z.string().min(1).max(200).optional() }) },
    responses: {
      200: { description: "A page of the log", content: { "application/json": { schema: adminAuditPageSchema } } },
      400: {
        description: "Malformed cursor (invalid_cursor)",
        content: { "application/json": { schema: adminErrorSchema } },
      },
    },
  }),
  "admin",
);

export function auditRoutes(deps: AdminDeps) {
  const app = new OpenAPIHono<AdminEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidCursor, 400)),
  });
  return app.openapi(auditRoute, async (c) => {
    const { cursor } = c.req.valid("query");
    const after = cursor === undefined ? null : decodeCursor(cursor);
    if (cursor !== undefined && !after) return c.json(invalidCursor, 400);

    const log = schema.adminAuditLog;
    const rows = await deps.db
      .select({
        id: log.id,
        adminId: log.adminId,
        adminEmail: schema.user.email,
        action: log.action,
        target: log.target,
        details: log.details,
        createdAt: log.createdAt,
      })
      .from(log)
      .leftJoin(schema.user, eq(schema.user.id, log.adminId))
      .where(
        after
          ? sql`(${log.createdAt}, ${log.id}) < (${after.createdAt.toISOString()}::timestamptz, ${after.id}::uuid)`
          : undefined,
      )
      .orderBy(sql`${log.createdAt} desc`, sql`${log.id} desc`)
      .limit(ADMIN_AUDIT_PAGE_SIZE + 1);

    const page = rows.slice(0, ADMIN_AUDIT_PAGE_SIZE);
    const last = page.at(-1);
    return c.json(
      {
        entries: page.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        nextCursor: rows.length > ADMIN_AUDIT_PAGE_SIZE && last ? encodeCursor(last) : null,
      },
      200,
    );
  });
}
