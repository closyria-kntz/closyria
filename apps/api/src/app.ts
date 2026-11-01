import { healthSchema } from "@closyria/shared";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { type AccessEnv, appWide, defineAccess, provideSession, type SessionSource } from "./access";
import { auditMiddleware } from "./admin-audit";
import { auditRoutes } from "./routes/admin/audit";
import { type AdminDeps, overviewRoutes } from "./routes/admin/overview";
import { type EventsDeps, eventsRoutes } from "./routes/events";
import { type MediaDeps, mediaRoutes } from "./routes/media";
import { type TestMailDeps, testMailRoutes } from "./routes/test-mail";

export type AppDeps = {
  env: string;
  version: string;
  pingDb: () => Promise<boolean>;
  /** Better Auth, served under /api/auth/*. */
  auth: { handler: (request: Request) => Promise<Response> } & SessionSource;
  /** Photos: database rows and object storage. */
  media: MediaDeps;
  /** First-party audience events. */
  events: EventsDeps;
  /** Admin area: dashboard figures and the audit log. */
  admin: AdminDeps;
  /** The memory mailer, exposed to the browser tests. Only ever given with APP_ENV=test (R18). */
  testMail?: TestMailDeps;
};

const healthRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/health",
    summary: "Service and database health",
    responses: {
      200: { description: "Healthy", content: { "application/json": { schema: healthSchema } } },
      503: { description: "Database unreachable", content: { "application/json": { schema: healthSchema } } },
    },
  }),
  "public",
);

export function createApp(deps: AppDeps) {
  // Fail closed: the e-mail inspection route must never exist outside the browser tests.
  if (deps.testMail && deps.env !== "test") throw new Error("testMail is only available with APP_ENV=test");
  const app = new OpenAPIHono<AccessEnv>().basePath("/api");
  // Baseline response headers (task 13). The CSP belongs to the pages, HSTS to Caddy.
  app.use(
    "*",
    appWide(async (c, next) => {
      await next();
      c.header("X-Content-Type-Options", "nosniff");
      c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    }),
  );
  app.use("*", provideSession(deps.auth));
  // Journals every admin mutation (spec §8): declared app-wide so no admin route can forget it.
  app.use("*", auditMiddleware(deps.admin.db));

  app.on(["GET", "POST"], "/auth/*", (c) => deps.auth.handler(c.req.raw));

  const routes = app
    .openapi(healthRoute, async (c) => {
      const dbOk = await deps.pingDb();
      const body = {
        status: dbOk ? "ok" : "degraded",
        env: deps.env,
        version: deps.version,
        database: dbOk ? "ok" : "error",
      } as const;
      return dbOk ? c.json(body, 200) : c.json(body, 503);
    })
    .route("/", mediaRoutes(deps.media))
    .route("/", eventsRoutes(deps.events))
    .route("/", overviewRoutes(deps.admin))
    .route("/", auditRoutes(deps.admin));

  // Not part of AppType: no client calls it, and it is absent from every real environment.
  if (deps.testMail) app.route("/", testMailRoutes(deps.testMail));

  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Closyria API", version: deps.version },
  });

  return routes;
}

export type AppType = ReturnType<typeof createApp>;
