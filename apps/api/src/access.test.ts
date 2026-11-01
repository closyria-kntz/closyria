import type { Session } from "@closyria/auth";
import type { Database } from "@closyria/db";
import { memoryStore } from "@closyria/storage";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import {
  type AccessEnv,
  defineAccess,
  findStrayRoutes,
  findUndeclaredOperations,
  type OpenApiDocument,
  provideSession,
} from "./access";
import { createApp } from "./app";

const noContent = { 200: { description: "ok", content: { "application/json": { schema: z.object({}) } } } };

/** A session as Better Auth returns it, reduced to what access control reads. */
function session(role: "user" | "admin", authMethod: string, isAnonymous = false): Session {
  return { user: { id: "u1", role, isAnonymous }, session: { authMethod } } as unknown as Session;
}

function appWith(current: Session | null) {
  const app = new OpenAPIHono<AccessEnv>();
  app.use("*", provideSession({ getSession: async () => current }));
  for (const level of ["public", "user", "admin"] as const) {
    app.openapi(defineAccess(createRoute({ method: "get", path: `/${level}`, responses: noContent }), level), (c) =>
      c.json({ level, user: c.get("session")?.user.id ?? null }, 200),
    );
  }
  return app;
}

describe("defineAccess", () => {
  it("stores the level on the route and installs the middleware", () => {
    const route = defineAccess(createRoute({ method: "get", path: "/x", responses: noContent }), "user");
    expect(route["x-access"]).toBe("user");
    expect(route.middleware).toBeDefined();
  });
});

describe("accessMiddleware", () => {
  it("lets a public route through without a session", async () => {
    const res = await appWith(null).request("/public");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ level: "public", user: null });
  });

  it("answers 401 on a user route without a session", async () => {
    const res = await appWith(null).request("/user");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("accepts an anonymous session on a user route and exposes it on the context", async () => {
    const res = await appWith(session("user", "anonymous", true)).request("/user");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ level: "user", user: "u1" });
  });

  it("answers 401 on an admin route without a session", async () => {
    const res = await appWith(null).request("/admin");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it.each([
    ["a non-admin with a passkey", session("user", "passkey")],
    ["an admin signed in by e-mail code", session("admin", "email-otp")],
    ["an admin signed in with Google", session("admin", "google")],
    ["an anonymous admin", session("admin", "anonymous", true)],
  ])("answers 403 on an admin route for %s", async (_name, current) => {
    const res = await appWith(current).request("/admin");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("accepts an admin with a passkey session", async () => {
    const res = await appWith(session("admin", "passkey")).request("/admin");
    expect(res.status).toBe(200);
  });

  it("fails closed when the session provider is not installed", async () => {
    const app = new OpenAPIHono<AccessEnv>();
    app.openapi(defineAccess(createRoute({ method: "get", path: "/x", responses: noContent }), "public"), (c) =>
      c.json({}, 200),
    );
    const res = await app.request("/x");
    expect(res.status).toBe(500);
  });

  it("resolves the session once per request", async () => {
    let calls = 0;
    const app = new OpenAPIHono<AccessEnv>();
    app.use(
      "*",
      provideSession({
        getSession: async () => {
          calls++;
          return session("user", "anonymous", true);
        },
      }),
    );
    app.openapi(defineAccess(createRoute({ method: "get", path: "/x", responses: noContent }), "user"), (c) =>
      c.json({}, 200),
    );
    await app.request("/x");
    expect(calls).toBe(1);
  });
});

describe("route coverage", () => {
  const make = () =>
    createApp({
      env: "test",
      version: "t",
      pingDb: async () => true,
      auth: { handler: async () => new Response(), getSession: async () => null },
      media: { db: {} as Database, store: memoryStore() }, // never reached: coverage reads the routes only
      events: { db: {} as Database },
      admin: { db: {} as Database },
    });
  const openapi = async (app: ReturnType<typeof make>) =>
    (await (await app.request("/api/openapi.json")).json()) as OpenApiDocument;

  it("declares a level on every OpenAPI operation", async () => {
    const doc = await openapi(make());
    expect(Object.keys(doc.paths).length).toBeGreaterThan(0);
    expect(findUndeclaredOperations(doc)).toEqual([]);
  });

  it("declares GET /api/health as public", async () => {
    const doc = await openapi(make());
    expect(doc.paths["/api/health"]?.get?.["x-access"]).toBe("public");
  });

  it("declares the admin routes as admin", async () => {
    const doc = await openapi(make());
    expect(doc.paths["/api/admin/overview"]?.get?.["x-access"]).toBe("admin");
    expect(doc.paths["/api/admin/audit"]?.get?.["x-access"]).toBe("admin");
  });

  it("flags an operation registered without defineAccess", async () => {
    const app = make();
    app.openapi(createRoute({ method: "get", path: "/leak", responses: noContent }), (c) => c.json({}, 200));
    expect(findUndeclaredOperations(await openapi(app))).toEqual(["GET /api/leak"]);
  });

  it("registers no route outside the OpenAPI operations and the public allowlist", async () => {
    const app = make();
    expect(findStrayRoutes(app, await openapi(app))).toEqual([]);
  });

  it("flags a plain Hono route", async () => {
    const app = make();
    app.get("/sneaky", (c) => c.text("hi"));
    expect(findStrayRoutes(app, await openapi(app))).toEqual(["GET /api/sneaky"]);
  });

  it("flags an all() route", async () => {
    const app = make();
    app.all("/sneaky-all", (c) => c.text("hi"));
    expect(findStrayRoutes(app, await openapi(app))).toEqual(["ALL /api/sneaky-all"]);
  });

  it("flags a use() handler other than the session provider", async () => {
    const app = make();
    app.use("/x/*", async (_c, next) => next());
    expect(findStrayRoutes(app, await openapi(app))).toEqual(["ALL /api/x/*"]);
  });

  it("publishes the 401 and 403 responses of user and admin routes", async () => {
    const app = new OpenAPIHono<AccessEnv>();
    for (const level of ["public", "user", "admin"] as const) {
      app.openapi(defineAccess(createRoute({ method: "get", path: `/${level}`, responses: noContent }), level), (c) =>
        c.json({}, 200),
      );
    }
    app.doc31("/doc", { openapi: "3.1.0", info: { title: "t", version: "1" } });
    const doc = (await (await app.request("/doc")).json()) as {
      paths: Record<string, { get: { responses: Record<string, unknown> } }>;
    };
    const codes = (p: string) => Object.keys(doc.paths[p]?.get.responses ?? {}).sort();
    expect(codes("/public")).toEqual(["200"]);
    expect(codes("/user")).toEqual(["200", "401"]);
    expect(codes("/admin")).toEqual(["200", "401", "403"]);
  });

  it("does not read the session on a public route", async () => {
    const app = new OpenAPIHono<AccessEnv>();
    app.use(
      "*",
      provideSession({
        getSession: async () => {
          throw new Error("database down");
        },
      }),
    );
    app.openapi(defineAccess(createRoute({ method: "get", path: "/p", responses: noContent }), "public"), (c) =>
      c.json({}, 200),
    );
    expect((await app.request("/p", { headers: { cookie: "better-auth.session_token=x" } })).status).toBe(200);
  });
});
