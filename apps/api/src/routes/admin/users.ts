import { and, type Database, eq, type SQL, schema, sql } from "@closyria/db";
import {
  ADMIN_USERS_PAGE_SIZE,
  type AdminSignInMethod,
  adminUserDeleteSchema,
  adminUserDetailSchema,
  adminUserErrorSchema,
  adminUserListSchema,
  adminUsersQuerySchema,
  GUEST_DELETE_CONFIRMATION,
} from "@closyria/shared";
import type { ObjectStore } from "@closyria/storage";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { defineAccess } from "../../access";
import { deleteUserAccount } from "../../account-deletion";
import { type AdminEnv, noteAudit } from "../../admin-audit";

export type AdminUsersDeps = { db: Database; store: ObjectStore };

const invalidRequest = { error: "invalid_request" } as const;
const notFound = { error: "not_found" } as const;
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: adminUserErrorSchema } },
});
const idParam = z.object({ id: z.string().min(1).max(200) });

// ---- keyset cursor: the (created_at, id) of the last person of the page ----

/** `user.created_at` as Postgres prints it (timestamp without time zone, up to microseconds): kept exact. */
const PG_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/;
type Position = { createdAt: string; id: string };

export function encodeUserCursor(position: Position): string {
  return Buffer.from(`${position.createdAt}|${position.id}`).toString("base64url");
}

/** The position in a cursor, or null when it is not one this API produced. */
export function decodeUserCursor(cursor: string): Position | null {
  const [createdAt, id, ...rest] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (rest.length > 0 || !createdAt || !id || !PG_TIMESTAMP.test(createdAt) || id.length > 200) return null;
  return { createdAt, id };
}

// ---- the facts of a person, all in one statement (counts are subqueries, never one query per person) ----

const u = schema.user;
const isGuest = sql<boolean>`coalesce(${u.isAnonymous}, false)`;
/** A timestamptz as an ISO string (UTC, milliseconds). */
const iso = (value: SQL) => sql`to_char((${value}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const countOf = (from: SQL) => sql<number>`(select count(*)::int from ${from})`;

const rowColumns = {
  id: u.id,
  email: u.email,
  isAnonymous: isGuest,
  role: u.role,
  createdAt: u.createdAt,
  createdAtText: sql<string>`${u.createdAt}::text`,
  // Better Auth's timestamps have no time zone and hold UTC wall-clock times.
  lastActiveAt: sql<string | null>`${iso(sql`greatest(
    (select max(${schema.session.updatedAt}) from ${schema.session} where ${schema.session.userId} = ${u.id}) at time zone 'UTC',
    (select max(${schema.events.occurredAt}) from ${schema.events} where ${schema.events.userId} = ${u.id}))`)}`,
  itemCount: countOf(sql`${schema.items} where ${schema.items.userId} = ${u.id} and ${schema.items.deletedAt} is null`),
  pushDevices: countOf(sql`${schema.pushSubscriptions} where ${schema.pushSubscriptions.userId} = ${u.id}`),
};

type Row = {
  id: string;
  email: string;
  isAnonymous: boolean;
  role: "user" | "admin";
  createdAt: Date;
  lastActiveAt: string | null;
  itemCount: number;
  pushDevices: number;
};

const toRow = (r: Row) => ({
  id: r.id,
  email: r.isAnonymous ? null : r.email,
  isAnonymous: r.isAnonymous,
  role: r.role,
  createdAt: r.createdAt.toISOString(),
  lastActiveAt: r.lastActiveAt,
  itemCount: r.itemCount,
  pushDevices: r.pushDevices,
});

// ---- routes ----

const listRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/admin/users",
    summary: "People: accounts and guests, newest first",
    description: `${ADMIN_USERS_PAGE_SIZE} per page. \`q\` searches accounts' e-mails; \`kind\` keeps accounts or guests. Counts only, never the contents of a wardrobe.`,
    request: { query: adminUsersQuerySchema },
    responses: {
      200: { description: "A page", content: { "application/json": { schema: adminUserListSchema } } },
      400: errorContent("Invalid filter or cursor"),
    },
  }),
  "admin",
);

const detailRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/admin/users/{id}",
    summary: "One person's facts and counts",
    description: "Profiles, lists, wished and owned items, sessions and sign-in methods: counts and kinds only.",
    request: { params: idParam },
    responses: {
      200: { description: "The person", content: { "application/json": { schema: adminUserDetailSchema } } },
      404: errorContent("Unknown person"),
    },
  }),
  "admin",
);

const deleteRoute = defineAccess(
  createRoute({
    method: "delete",
    path: "/admin/users/{id}",
    summary: "Delete a person and everything she owns (RGPD request)",
    description: `\`confirmation\`: her e-mail, or \`${GUEST_DELETE_CONFIRMATION}\` for a guest. Every owned row goes (cascade) and her stored photos are deleted. An admin cannot delete herself nor another admin.`,
    request: {
      params: idParam,
      body: { required: true, content: { "application/json": { schema: adminUserDeleteSchema } } },
    },
    responses: {
      204: { description: "Deleted" },
      400: errorContent("The confirmation does not match (confirmation_mismatch) or the request is invalid"),
      404: errorContent("Unknown person"),
      409: errorContent("self: her own account; admin: another admin's account"),
    },
  }),
  "admin",
);

/** Which ways she can sign in: a passkey, Google or Apple she linked, and a code by e-mail for any account. */
async function signInMethods(db: Database, id: string, isAnonymous: boolean): Promise<AdminSignInMethod[]> {
  const [[passkeys], providers] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(schema.passkey).where(eq(schema.passkey.userId, id)),
    db
      .selectDistinct({ providerId: schema.account.providerId })
      .from(schema.account)
      .where(eq(schema.account.userId, id)),
  ]);
  const linked = new Set(providers.map((p) => p.providerId));
  const methods: AdminSignInMethod[] = [];
  if ((passkeys?.n ?? 0) > 0) methods.push("passkey");
  if (linked.has("google")) methods.push("google");
  if (linked.has("apple")) methods.push("apple");
  if (!isAnonymous) methods.push("email-otp");
  return methods;
}

export function adminUsersRoutes(deps: AdminUsersDeps) {
  const { db } = deps;
  const app = new OpenAPIHono<AdminEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });
  return app
    .openapi(listRoute, async (c) => {
      const { q, kind, cursor } = c.req.valid("query");
      const after = cursor === undefined ? null : decodeUserCursor(cursor);
      if (cursor !== undefined && !after) return c.json(invalidRequest, 400);
      const escaped = q?.replace(/[\\%_]/g, (ch) => `\\${ch}`);
      const rows = await db
        .select(rowColumns)
        .from(u)
        .where(
          and(
            // A guest's generated address is not hers: the search only reads accounts'.
            escaped === undefined ? undefined : sql`not ${isGuest} and ${u.email} ilike ${`%${escaped}%`}`,
            kind === "accounts" ? sql`not ${isGuest}` : undefined,
            kind === "guests" ? sql`${isGuest}` : undefined,
            after ? sql`(${u.createdAt}, ${u.id}) < (${after.createdAt}::timestamp, ${after.id})` : undefined,
          ),
        )
        .orderBy(sql`${u.createdAt} desc`, sql`${u.id} desc`)
        .limit(ADMIN_USERS_PAGE_SIZE + 1);
      const page = rows.slice(0, ADMIN_USERS_PAGE_SIZE);
      const last = page.at(-1);
      return c.json(
        {
          users: page.map(toRow),
          nextCursor:
            rows.length > ADMIN_USERS_PAGE_SIZE && last
              ? encodeUserCursor({ createdAt: last.createdAtText, id: last.id })
              : null,
        },
        200,
      );
    })
    .openapi(detailRoute, async (c) => {
      const { id } = c.req.valid("param");
      const owned = (table: SQL, extra?: SQL) =>
        countOf(sql`${table} where user_id = ${u.id}${extra ? sql` and ${extra}` : sql``}`);
      const [found] = await db
        .select({
          ...rowColumns,
          profiles: owned(sql`${schema.profiles}`),
          wishlists: owned(sql`${schema.wishlists}`),
          spottedItems: owned(sql`${schema.items}`, sql`deleted_at is null and stage = 'spotted'`),
          ownedItems: owned(sql`${schema.items}`, sql`deleted_at is null and stage = 'owned'`),
          sessions: owned(sql`${schema.session}`),
        })
        .from(u)
        .where(eq(u.id, id));
      if (!found) return c.json(notFound, 404);
      return c.json(
        {
          ...toRow(found),
          profiles: found.profiles,
          wishlists: found.wishlists,
          spottedItems: found.spottedItems,
          ownedItems: found.ownedItems,
          sessions: found.sessions,
          signInMethods: await signInMethods(db, found.id, found.isAnonymous),
        },
        200,
      );
    })
    .openapi(deleteRoute, async (c) => {
      const { id } = c.req.valid("param");
      const { confirmation } = c.req.valid("json");
      noteAudit(c, { action: "user.delete", target: `user:${id}` });
      if (c.var.session?.user.id === id) return c.json({ error: "self" } as const, 409);
      const [target] = await db
        .select({ email: u.email, isAnonymous: isGuest, role: u.role })
        .from(u)
        .where(eq(u.id, id));
      if (!target) return c.json(notFound, 404);
      if (target.role === "admin") return c.json({ error: "admin" } as const, 409);
      const expected = target.isAnonymous ? GUEST_DELETE_CONFIRMATION : target.email.toLowerCase();
      const typed = target.isAnonymous ? confirmation : confirmation.toLowerCase();
      if (typed !== expected) return c.json({ error: "confirmation_mismatch" } as const, 400);
      const adminId = c.var.session?.user.id;
      if (!adminId) throw new Error("admin route reached without a session");
      const outcome = await deleteUserAccount(db, deps.store, id, {
        adminId,
        method: c.req.method,
        path: c.req.path,
      });
      if (outcome === "not_found") return c.json(notFound, 404);
      if (outcome === "admin") return c.json({ error: "admin" } as const, 409);
      // Its audit row was written with the deletion, in the same transaction.
      noteAudit(c, { action: "user.delete", target: `user:${id}`, recordedInTransaction: true });
      return c.body(null, 204);
    });
}
