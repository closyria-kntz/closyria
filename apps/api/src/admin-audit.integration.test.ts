import { createAuth, memoryMailer } from "@closyria/auth";
import { createDb, eq, schema } from "@closyria/db";
import type { TestDatabase } from "@closyria/testing";
import { createTestDatabase } from "@closyria/testing/vitest";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defineAccess, provideSession } from "./access";
import { type AdminEnv, auditMiddleware, noteAudit } from "./admin-audit";

const BASE_URL = "http://localhost:3001";
const ok = { 200: { description: "ok", content: { "application/json": { schema: z.object({}) } } } };
const thingBody = z.object({ email: z.string(), note: z.string() });

let database: TestDatabase;
let handle: ReturnType<typeof createDb>;
let auth: ReturnType<typeof createAuth>;
let app: OpenAPIHono<AdminEnv>;
let ipCounter = 0;

/** A real Better Auth session, then promoted in the database (as access.integration.test.ts does). */
async function session(role: "user" | "admin", authMethod: "email-otp" | "passkey") {
  const res = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { origin: BASE_URL, "x-forwarded-for": `10.4.0.${++ipCounter}`, "user-agent": "closyria-tests" },
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { user: { id: string }; token: string };
  await handle.db.update(schema.user).set({ role, isAnonymous: false }).where(eq(schema.user.id, body.user.id));
  await handle.db.update(schema.session).set({ authMethod }).where(eq(schema.session.token, body.token));
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { cookie, userId: body.user.id };
}

const send = (method: string, path: string, cookie: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const rows = () => handle.db.select().from(schema.adminAuditLog);

beforeAll(async () => {
  database = await createTestDatabase();
  handle = createDb(database.url, { max: 5 });
  vi.spyOn(console, "log").mockImplementation(() => {});
  auth = createAuth({
    db: handle.db,
    mailer: memoryMailer(),
    baseUrl: BASE_URL,
    secret: "test-secret-that-is-long-enough-0123456789",
  });
  app = new OpenAPIHono<AdminEnv>();
  app.use("*", provideSession(auth));
  app.use("*", auditMiddleware(handle.db));
  // Admin mutation that notes what it did; the request body carries personal data that must not be stored.
  app.openapi(
    defineAccess(
      createRoute({
        method: "post",
        path: "/things/{id}",
        request: {
          params: z.object({ id: z.string() }),
          body: { content: { "application/json": { schema: thingBody } } },
        },
        responses: ok,
      }),
      "admin",
    ),
    (c) => {
      noteAudit(c, { action: "thing.update", target: `thing:${c.req.valid("param").id}`, details: { fields: 2 } });
      return c.json({}, 200);
    },
  );
  // Admin mutation that notes nothing: the default action is the method and the route.
  app.openapi(defineAccess(createRoute({ method: "delete", path: "/things/{id}", responses: ok }), "admin"), (c) =>
    c.json({}, 200),
  );
  app.openapi(defineAccess(createRoute({ method: "get", path: "/things", responses: ok }), "admin"), (c) =>
    c.json({}, 200),
  );
  app.openapi(defineAccess(createRoute({ method: "post", path: "/mine", responses: ok }), "user"), (c) =>
    c.json({}, 200),
  );
}, 60_000);

beforeEach(async () => {
  await handle.db.delete(schema.adminAuditLog);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await handle?.pool.end();
  await database?.stop();
});

describe("auditMiddleware", () => {
  it("records one row per admin mutation, with what the handler noted and never the request body", async () => {
    const admin = await session("admin", "passkey");
    const res = await send("POST", "/things/42", admin.cookie, { email: "jane@example.com", note: "secret note" });
    expect(res.status).toBe(200);

    const all = await rows();
    expect(all).toHaveLength(1);
    const [row] = all;
    expect(row).toMatchObject({
      adminId: admin.userId,
      action: "thing.update",
      target: "thing:42",
      details: { fields: 2, method: "POST", path: "/things/42", status: 200 },
    });
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(JSON.stringify(all)).not.toMatch(/jane@example\.com|secret note/);
  });

  it("falls back to the method and the route pattern, and records the response status", async () => {
    const admin = await session("admin", "passkey");
    expect((await send("DELETE", "/things/7", admin.cookie)).status).toBe(200);
    const [row] = await rows();
    expect(row).toMatchObject({
      action: "DELETE /things/:id",
      target: null,
      details: { method: "DELETE", path: "/things/7", status: 200 },
    });
  });

  it("records an admin mutation refused by validation, with its status", async () => {
    const admin = await session("admin", "passkey");
    expect((await send("POST", "/things/1", admin.cookie, { email: 3 })).status).toBe(400);
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]?.details).toMatchObject({ method: "POST", status: 400 });
  });

  it("records nothing for an admin read", async () => {
    const admin = await session("admin", "passkey");
    expect((await send("GET", "/things", admin.cookie)).status).toBe(200);
    expect(await rows()).toHaveLength(0);
  });

  it("records nothing for a mutation on a non-admin route", async () => {
    const admin = await session("admin", "passkey");
    expect((await send("POST", "/mine", admin.cookie)).status).toBe(200);
    expect(await rows()).toHaveLength(0);
  });

  it("records nothing when access is refused", async () => {
    const byCode = await session("admin", "email-otp");
    const user = await session("user", "passkey");
    expect((await send("POST", "/things/1", byCode.cookie, { email: "a", note: "b" })).status).toBe(403);
    expect((await send("POST", "/things/1", user.cookie, { email: "a", note: "b" })).status).toBe(403);
    expect((await send("POST", "/things/1", "", { email: "a", note: "b" })).status).toBe(401);
    expect(await rows()).toHaveLength(0);
  });

  it("keeps the rows when the admin account is deleted (admin_id set to null)", async () => {
    const admin = await session("admin", "passkey");
    await send("DELETE", "/things/9", admin.cookie);
    await handle.db.delete(schema.user).where(eq(schema.user.id, admin.userId));
    const [row] = await rows();
    expect(row?.adminId).toBeNull();
    expect(row?.action).toBe("DELETE /things/:id");
  });
});
