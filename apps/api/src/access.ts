import type { Session } from "@closyria/auth";
import { type RouteConfig, z } from "@hono/zod-openapi";
import type { Env, Hono, MiddlewareHandler } from "hono";
import { routePath } from "hono/route";

/**
 * Who may call a route (spec §8, §9):
 * - `public`: anyone, no session needed.
 * - `user`: any valid session, anonymous ones included (they own data too).
 * - `admin`: a session of an admin user opened with a passkey.
 */
export const ACCESS_LEVELS = ["public", "user", "admin"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

/** Hono environment of the API: the session is resolved once and handlers never look it up again. */
export type AccessEnv = {
  Variables: {
    /** The caller's session, or null. Always set on routes declared with `defineAccess`. */
    session: Session | null;
    getSession: () => Promise<Session | null>;
    /** Set once access is granted: the route's declared level and its pattern (e.g. `/api/admin/users/:id`). */
    access?: { level: AccessLevel; route: string };
  };
} & Env;

export type SessionSource = { getSession: (headers: Headers) => Promise<Session | null> };

/** Installs the (memoized) session lookup for the request. Register it with `app.use("*", …)` before any route. */
export function provideSession(source: SessionSource): MiddlewareHandler<AccessEnv> {
  return appWide<AccessEnv>(async (c, next) => {
    let pending: Promise<Session | null> | undefined;
    c.set("getSession", () => {
      pending ??= source.getSession(c.req.raw.headers);
      return pending;
    });
    await next();
  });
}

/** App-wide handlers that `findStrayRoutes` accepts: the session provider and the admin audit. */
const appWideHandlers = new WeakSet<object>();

/**
 * Marks a middleware as a legitimate app-wide handler (`app.use("*", …)`), never a route of its own.
 * Only for cross-cutting middleware that answers nothing by itself.
 */
export function appWide<E extends Env>(handler: MiddlewareHandler<E>): MiddlewareHandler<E> {
  appWideHandlers.add(handler);
  return handler;
}

/** Per-route enforcement. 401 without a session, 403 when an admin route is not met by an admin passkey session. */
export function accessMiddleware(level: AccessLevel): MiddlewareHandler<AccessEnv> {
  return async (c, next) => {
    const getSession = c.get("getSession");
    // Fail closed: a route reached without the session provider is a wiring bug, never a public route.
    if (!getSession) throw new Error("provideSession() must be registered before routes declared with defineAccess");
    // Public routes never touch the session store (the health check must work when the database is down).
    // A public handler that wants the optional session calls `c.var.getSession()`.
    const session = level === "public" ? null : await getSession();
    c.set("session", session);
    if (level !== "public") {
      if (!session) return c.json({ error: "unauthorized" }, 401);
      if (level === "admin" && !(session.user.role === "admin" && session.session.authMethod === "passkey")) {
        return c.json({ error: "forbidden" }, 403);
      }
    }
    c.set("access", { level, route: routePath(c) });
    await next();
  };
}

const errorBody = (code: string) => ({
  description: code === "unauthorized" ? "No valid session" : "Not allowed for this account",
  content: { "application/json": { schema: z.object({ error: z.literal(code) }) } },
});

/**
 * Declares who may call an OpenAPI route and enforces it. The level is published as the
 * `x-access` extension of the operation, so `/api/openapi.json` lets tests prove that
 * every route has one (`findUndeclaredOperations`).
 */
export function defineAccess<R extends RouteConfig>(route: R, level: AccessLevel) {
  const own = route.middleware;
  const middleware = [accessMiddleware(level), ...(own ? (Array.isArray(own) ? own : [own]) : [])];
  const responses = {
    ...(level === "public" ? {} : { 401: errorBody("unauthorized") }),
    ...(level === "admin" ? { 403: errorBody("forbidden") } : {}),
    ...route.responses,
  };
  return { ...route, responses, "x-access": level, middleware } as R & {
    "x-access": AccessLevel;
    middleware: typeof middleware;
  };
}

/**
 * Routes that are not OpenAPI operations and are public by design. Anything else
 * registered on the app must be an OpenAPI operation declared with `defineAccess`.
 */
export const PUBLIC_NON_OPENAPI_ROUTES = [
  { method: "GET", path: "/api/auth/*" }, // Better Auth enforces its own rules
  { method: "POST", path: "/api/auth/*" },
  { method: "GET", path: "/api/openapi.json" },
] as const;

export type OpenApiDocument = { paths: Record<string, Record<string, { "x-access"?: unknown }>> };

/** The operations of an OpenAPI document with no valid `x-access` (as "METHOD /path"). */
export function findUndeclaredOperations(doc: OpenApiDocument): string[] {
  return Object.entries(doc.paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([, op]) => !ACCESS_LEVELS.includes(op["x-access"] as AccessLevel))
      .map(([method]) => `${method.toUpperCase()} ${path}`),
  );
}

/**
 * Routes registered on `app` that are neither a documented OpenAPI operation, nor in the public
 * allowlist, nor an `appWide` middleware (as "METHOD /path"). Must be empty.
 */
export function findStrayRoutes(app: Pick<Hono, "routes">, doc: OpenApiDocument): string[] {
  const documented = new Set(
    Object.entries(doc.paths).flatMap(([path, item]) =>
      Object.keys(item).map((m) => `${m.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ":$1")}`),
    ),
  );
  const allowed = new Set(PUBLIC_NON_OPENAPI_ROUTES.map((r) => `${r.method} ${r.path}`));
  return app.routes
    .filter((r) => !appWideHandlers.has(r.handler))
    .map((r) => `${r.method} ${r.path}`)
    .filter((id) => !documented.has(id) && !allowed.has(id));
}
