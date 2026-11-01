import type { Session } from "@closyria/auth";
import type { RouteConfig } from "@hono/zod-openapi";
import type { Env, MiddlewareHandler } from "hono";

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
  };
} & Env;

export type SessionSource = { getSession: (headers: Headers) => Promise<Session | null> };

/** Installs the (memoized) session lookup for the request. Register it with `app.use("*", …)` before any route. */
export function provideSession(source: SessionSource): MiddlewareHandler<AccessEnv> {
  return async (c, next) => {
    let pending: Promise<Session | null> | undefined;
    c.set("getSession", () => {
      pending ??= source.getSession(c.req.raw.headers);
      return pending;
    });
    await next();
  };
}

/** Per-route enforcement. 401 without a session, 403 when an admin route is not met by an admin passkey session. */
export function accessMiddleware(level: AccessLevel): MiddlewareHandler<AccessEnv> {
  return async (c, next) => {
    const getSession = c.get("getSession");
    // Fail closed: a route reached without the session provider is a wiring bug, never a public route.
    if (!getSession) throw new Error("provideSession() must be registered before routes declared with defineAccess");
    const session = await getSession();
    c.set("session", session);
    if (level !== "public") {
      if (!session) return c.json({ error: "unauthorized" }, 401);
      if (level === "admin" && !(session.user.role === "admin" && session.session.authMethod === "passkey")) {
        return c.json({ error: "forbidden" }, 403);
      }
    }
    await next();
  };
}

/**
 * Declares who may call an OpenAPI route and enforces it. The level is published as the
 * `x-access` extension of the operation, so `/api/openapi.json` lets tests prove that
 * every route has one (`findUndeclaredOperations`).
 */
export function defineAccess<R extends RouteConfig>(route: R, level: AccessLevel) {
  const own = route.middleware;
  const middleware = [accessMiddleware(level), ...(own ? (Array.isArray(own) ? own : [own]) : [])];
  return { ...route, "x-access": level, middleware } as R & { "x-access": AccessLevel; middleware: typeof middleware };
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
