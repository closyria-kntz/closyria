import { createAuth, memoryMailer } from "@closyria/auth";
import { createDb, schema } from "@closyria/db";
import { migrateTestDatabase, startTestDatabase, type TestDatabase } from "@closyria/testing";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type AccessEnv, defineAccess, provideSession } from "./access";

const BASE_URL = "http://localhost:3001";
const responses = { 200: { description: "ok", content: { "application/json": { schema: z.object({}) } } } };

let database: TestDatabase;
let handle: ReturnType<typeof createDb>;
let auth: ReturnType<typeof createAuth>;
let app: OpenAPIHono<AccessEnv>;
let ipCounter = 0;

/** Opens a real anonymous session through Better Auth and returns its Cookie header and ids. */
async function signIn() {
  const res = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { origin: BASE_URL, "x-forwarded-for": `10.1.0.${++ipCounter}`, "user-agent": "closyria-tests" },
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { user: { id: string }; token: string };
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { cookie, userId: body.user.id, token: body.token };
}

const get = (path: string, cookie?: string) => app.request(path, cookie ? { headers: { cookie } } : {});

beforeAll(async () => {
  database = await startTestDatabase();
  await migrateTestDatabase(database.url);
  handle = createDb(database.url, { max: 5 });
  vi.spyOn(console, "log").mockImplementation(() => {});
  auth = createAuth({
    db: handle.db,
    mailer: memoryMailer(),
    baseUrl: BASE_URL,
    secret: "test-secret-that-is-long-enough-0123456789",
  });
  app = new OpenAPIHono<AccessEnv>();
  app.use("*", provideSession(auth));
  for (const level of ["public", "user", "admin"] as const) {
    app.openapi(defineAccess(createRoute({ method: "get", path: `/${level}`, responses }), level), (c) =>
      c.json({ userId: c.get("session")?.user.id ?? null }, 200),
    );
  }
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await handle?.pool.end();
  await database?.stop();
});

describe("access levels with real Better Auth sessions", () => {
  it("serves public routes without a cookie and user routes only with a session", async () => {
    expect((await get("/public")).status).toBe(200);
    expect((await get("/user")).status).toBe(401);
    expect((await get("/user", "better-auth.session_token=forged")).status).toBe(401);
    const { cookie, userId } = await signIn();
    const res = await get("/user", cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId });
  });

  it("answers 401 on an admin route without a session, 403 for an anonymous session", async () => {
    expect((await get("/admin")).status).toBe(401);
    const { cookie } = await signIn();
    expect((await get("/admin", cookie)).status).toBe(403);
  });

  // A genuine passkey sign-in is covered in packages/auth; here the session row of a real
  // cookie session is set to the state that sign-in produces (role admin, authMethod passkey).
  it("requires both the admin role and a passkey session", async () => {
    const { cookie, userId, token } = await signIn();
    const setRole = (role: "user" | "admin") =>
      handle.db.update(schema.user).set({ role }).where(eq(schema.user.id, userId));
    const setMethod = (authMethod: string) =>
      handle.db.update(schema.session).set({ authMethod }).where(eq(schema.session.token, token));

    await setRole("admin");
    expect((await get("/admin", cookie)).status).toBe(403); // admin, but anonymous session
    await setMethod("email-otp");
    expect((await get("/admin", cookie)).status).toBe(403); // admin, but not a passkey session
    await setMethod("passkey");
    expect((await get("/admin", cookie)).status).toBe(200); // both conditions
    await setRole("user");
    expect((await get("/admin", cookie)).status).toBe(403); // passkey session, not admin
  });
});
