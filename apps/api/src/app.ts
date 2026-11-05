import { healthSchema } from "@closyria/shared";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { csrf } from "hono/csrf";
import { type AccessEnv, appWide, defineAccess, provideSession, type SessionSource } from "./access";
import { auditMiddleware } from "./admin-audit";
import type { CatalogDeps } from "./catalog/deps";
import { catalogLimiter } from "./catalog/limiter";
import { auditRoutes } from "./routes/admin/audit";
import { adminCapturesRoutes } from "./routes/admin/captures";
import { type AdminDeps, overviewRoutes } from "./routes/admin/overview";
import { adminShopsRoutes } from "./routes/admin/shops";
import { capturesRoutes } from "./routes/captures";
import { type EventsDeps, eventsRoutes } from "./routes/events";
import { bulkRoutes } from "./routes/me/bulk";
import { itemMediaRoutes } from "./routes/me/item-media";
import { itemsRoutes } from "./routes/me/items";
import { profilesRoutes } from "./routes/me/profiles";
import { tagsRoutes } from "./routes/me/tags";
import { wishlistsRoutes } from "./routes/me/wishlists";
import { createMediaPipeline, type MediaDeps, mediaRoutes } from "./routes/media";
import { productsRoutes } from "./routes/products";
import { sharedRoutes } from "./routes/shared";
import { type TestMailDeps, testMailRoutes } from "./routes/test-mail";
import type { WardrobeDeps } from "./wardrobe/deps";

export type AppDeps = {
  env: string;
  version: string;
  /** The site's origin (BETTER_AUTH_URL's), the only one allowed to send form-like requests. */
  origin: string;
  pingDb: () => Promise<boolean>;
  /** Better Auth, served under /api/auth/*. */
  auth: { handler: (request: Request) => Promise<Response> } & SessionSource;
  /** Photos: database rows and object storage. */
  media: MediaDeps;
  /** Captures, product pages and catalog photos. */
  catalog: CatalogDeps;
  /** First-party audience events. */
  events: EventsDeps;
  /** Admin area: dashboard figures and the audit log. */
  admin: AdminDeps;
  /** Her profiles and items (`/api/me/…`). */
  wardrobe: WardrobeDeps;
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
  // CSRF: a form-like request (multipart, urlencoded, text/plain — the ones a foreign page can send
  // without a CORS preflight) that changes something must come from the site itself. Better Auth checks
  // its own routes against its trusted origins (Apple's form_post callback included), so it is skipped.
  const origin = new URL(deps.origin).origin;
  const csrfCheck = csrf({ origin });
  app.use(
    "*",
    appWide(async (c, next) => (c.req.path.startsWith("/api/auth/") ? next() : csrfCheck(c, next))),
  );
  app.use("*", provideSession(deps.auth));
  // Journals every admin mutation (spec §8): declared app-wide so no admin route can forget it.
  app.use("*", auditMiddleware(deps.admin.db));

  app.on(["GET", "POST"], "/auth/*", (c) => deps.auth.handler(c.req.raw));

  // One limiter for the captures and the manual entry: they count in the same hour.
  // One pipeline: `POST /api/media` and the item photos share the upload limits and the re-encoding semaphore.
  const mediaPipeline = createMediaPipeline(deps.media);
  const captureLimiter = catalogLimiter(deps.catalog.limits);
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
    .route("/", mediaRoutes(deps.media, mediaPipeline))
    .route("/", capturesRoutes(deps.catalog, captureLimiter))
    .route("/", productsRoutes(deps.catalog, captureLimiter))
    .route("/", eventsRoutes(deps.events))
    .route("/", profilesRoutes(deps.wardrobe))
    .route("/", bulkRoutes(deps.wardrobe))
    .route("/", itemsRoutes(deps.wardrobe))
    .route("/", itemMediaRoutes({ ...deps.wardrobe, store: deps.media.store }, mediaPipeline))
    .route("/", tagsRoutes(deps.wardrobe))
    .route("/", wishlistsRoutes(deps.wardrobe))
    .route("/", sharedRoutes(deps.wardrobe))
    .route("/", overviewRoutes(deps.admin))
    .route("/", auditRoutes(deps.admin))
    .route("/", adminShopsRoutes(deps.catalog))
    .route("/", adminCapturesRoutes(deps.catalog));

  // Not part of AppType: no client calls it, and it is absent from every real environment.
  if (deps.testMail) app.route("/", testMailRoutes(deps.testMail));

  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Closyria API", version: deps.version },
  });

  return routes;
}

export type AppType = ReturnType<typeof createApp>;
