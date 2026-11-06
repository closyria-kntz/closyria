import { createAuth, memoryMailer } from "@closyria/auth";
import { createDb, eq, ne, schema } from "@closyria/db";
import { adminAuditPageSchema, adminOverviewSchema } from "@closyria/shared";
import { memoryStore } from "@closyria/storage";
import type { TestDatabase } from "@closyria/testing";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app";

const BASE_URL = "http://localhost:3001";
// Far from the real clock: users created by the test sign-ins never fall on this day.
const NOW = new Date("2030-06-15T12:00:00.000Z");
const at = (iso: string) => new Date(iso);

let database: TestDatabase;
let handle: ReturnType<typeof createDb>;
let auth: ReturnType<typeof createAuth>;
let app: ReturnType<typeof createApp>;
let ipCounter = 0;

/** A real Better Auth session, then set in the database to the role and sign-in method under test. */
async function session(role: "user" | "admin", authMethod: "email-otp" | "passkey") {
  const res = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { origin: BASE_URL, "x-forwarded-for": `10.5.0.${++ipCounter}`, "user-agent": "closyria-tests" },
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

const get = (path: string, cookie?: string) => app.request(path, cookie ? { headers: { cookie } } : {});

let userCounter = 0;
const fixtureUser = (createdAt: Date, isAnonymous: boolean) => {
  const id = `fixture-${++userCounter}`;
  return { id, name: id, email: `${id}@example.test`, createdAt, updatedAt: createdAt, isAnonymous };
};
const fixtureEvent = (occurredAt: Date, name = "page_view") => ({ name, path: "/", occurredAt });

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
  app = createApp({
    origin: BASE_URL,
    env: "test",
    version: "test",
    pingDb: async () => true,
    auth,
    media: { db: handle.db, store: memoryStore() },
    events: { db: handle.db },
    catalog: { db: handle.db, store: memoryStore(), queue: { enqueue: async () => {} } },
    admin: { db: handle.db, now: () => NOW },
    wardrobe: { db: handle.db },
  });
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await handle?.pool.end();
  await database?.stop();
});

describe("GET /api/admin/overview", () => {
  it("is refused without a session, to a user, and to an admin signed in with a code", async () => {
    expect((await get("/api/admin/overview")).status).toBe(401);
    const user = await session("user", "passkey");
    expect((await get("/api/admin/overview", user.cookie)).status).toBe(403);
    const byCode = await session("admin", "email-otp");
    const res = await get("/api/admin/overview", byCode.cookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("counts users, today's events and today's sign-ups (UTC day)", async () => {
    const admin = await session("admin", "passkey");
    await handle.db.delete(schema.user).where(ne(schema.user.id, admin.userId));
    await handle.db.delete(schema.events);
    await handle.db.insert(schema.user).values([
      fixtureUser(at("2030-06-15T00:00:00.000Z"), false),
      fixtureUser(at("2030-06-15T23:59:59.999Z"), false),
      fixtureUser(at("2030-06-15T10:00:00.000Z"), true), // anonymous: not a sign-up
      fixtureUser(at("2030-06-14T23:59:59.999Z"), false), // yesterday
    ]);
    await handle.db
      .insert(schema.events)
      .values([
        fixtureEvent(at("2030-06-15T00:00:00.000Z")),
        fixtureEvent(at("2030-06-15T12:00:00.000Z"), "signup_completed"),
        fixtureEvent(at("2030-06-15T23:59:59.999Z")),
        fixtureEvent(at("2030-06-14T23:59:59.999Z")),
        fixtureEvent(at("2030-06-16T00:00:00.000Z")),
      ]);

    const res = await get("/api/admin/overview", admin.cookie);
    expect(res.status).toBe(200);
    const body = adminOverviewSchema.parse(await res.json());
    // The admin's own (registered) account is one of the users; it was not created on 2030-06-15.
    expect(body).toEqual({
      users: { total: 5, anonymous: 1, registered: 4 },
      eventsToday: 3,
      signupsToday: 2,
      captures: expect.any(Object),
      shops: expect.any(Object),
    });
  });

  it("does not write to the audit log (reads are not journalled)", async () => {
    await handle.db.delete(schema.adminAuditLog);
    const admin = await session("admin", "passkey");
    expect((await get("/api/admin/overview", admin.cookie)).status).toBe(200);
    expect(await handle.db.select().from(schema.adminAuditLog)).toHaveLength(0);
  });
});

describe("GET /api/admin/audit", () => {
  it("is refused to an admin signed in with a code", async () => {
    const byCode = await session("admin", "email-otp");
    expect((await get("/api/admin/audit", byCode.cookie)).status).toBe(403);
  });

  it("pages through the log, newest first, 50 per page, with ties on the date", async () => {
    const admin = await session("admin", "passkey");
    await handle.db.delete(schema.adminAuditLog);
    // 120 rows; 60 of them share one timestamp, so the id alone must break ties.
    const base = Date.parse("2030-06-01T00:00:00.000Z");
    await handle.db.insert(schema.adminAuditLog).values(
      Array.from({ length: 120 }, (_, i) => ({
        adminId: admin.userId,
        action: `action.${i}`,
        target: null,
        details: { i },
        createdAt: new Date(i < 60 ? base : base + i * 1000),
      })),
    );

    const seen: string[] = [];
    const sizes: number[] = [];
    let cursor: string | null = null;
    do {
      const res = await get(`/api/admin/audit${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, admin.cookie);
      expect(res.status).toBe(200);
      const page = adminAuditPageSchema.parse(await res.json());
      sizes.push(page.entries.length);
      seen.push(...page.entries.map((e) => e.id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
    const ordered = await handle.db.select().from(schema.adminAuditLog);
    ordered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
    expect(seen).toEqual(ordered.map((r) => r.id));
  });

  it("returns the admin's e-mail with each entry and no next cursor on the last page", async () => {
    const admin = await session("admin", "passkey");
    await handle.db.delete(schema.adminAuditLog);
    await handle.db.insert(schema.adminAuditLog).values({ adminId: admin.userId, action: "x", target: "user:1" });
    const page = adminAuditPageSchema.parse(await (await get("/api/admin/audit", admin.cookie)).json());
    expect(page.nextCursor).toBeNull();
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]).toMatchObject({ adminId: admin.userId, action: "x", target: "user:1" });
    expect(page.entries[0]?.adminEmail).toMatch(/@/);
  });

  it("rejects a malformed cursor with a stable code", async () => {
    const admin = await session("admin", "passkey");
    for (const cursor of ["nope", "bm9wZQ", encodeURIComponent(btoa("2030-01-01T00:00:00.000Z|not-a-uuid"))]) {
      const res = await get(`/api/admin/audit?cursor=${cursor}`, admin.cookie);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_cursor" });
    }
  });
});
