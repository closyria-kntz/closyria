import { healthSchema } from "@closyria/shared";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { csrf } from "hono/csrf";
import { type AccessEnv, appWide, defineAccess, provideSession, type SessionSource } from "./access";
import { auditMiddleware } from "./admin-audit";
import type { CatalogDeps } from "./catalog/deps";
import { catalogLimiter } from "./catalog/limiter";
import { auditRoutes } from "./routes/admin/audit";
import { adminCapturesRoutes } from "./routes/admin/captures";
import { adminCatalogueRoutes } from "./routes/admin/catalogue";
import { type AdminDeps, overviewRoutes } from "./routes/admin/overview";
import { adminProductsRoutes } from "./routes/admin/products";
import { adminReferenceRoutes } from "./routes/admin/reference";
import { adminSalesRoutes } from "./routes/admin/sales";
import { adminShippingOptionsRoutes } from "./routes/admin/shipping-options";
import { adminShopsRoutes } from "./routes/admin/shops";
import { adminUsersRoutes } from "./routes/admin/users";
import { capturesRoutes } from "./routes/captures";
import { catalogueRoutes } from "./routes/catalogue";
import { type DevAccessDeps, devAccessRoutes } from "./routes/dev-access";
import { type EventsDeps, eventsRoutes } from "./routes/events";
import { alertsRoutes, type PushDeps } from "./routes/me/alerts";
import { budgetsRoutes } from "./routes/me/budgets";
import { bulkRoutes } from "./routes/me/bulk";
import { changesRoutes } from "./routes/me/changes";
import { facetsRoutes } from "./routes/me/facets";
import { giftsRoutes } from "./routes/me/gifts";
import { groupOrdersRoutes } from "./routes/me/group-orders";
import { homeRoutes } from "./routes/me/home";
import { itemMediaRoutes } from "./routes/me/item-media";
import { itemsRoutes } from "./routes/me/items";
import { loveLevelsRoutes } from "./routes/me/love-levels";
import { orderDraftRoutes } from "./routes/me/order-draft";
import { preferencesRoutes } from "./routes/me/preferences";
import { profilesRoutes } from "./routes/me/profiles";
import { recentsRoutes } from "./routes/me/recents";
import { tagsRoutes } from "./routes/me/tags";
import { wishlistsRoutes } from "./routes/me/wishlists";
import { createMediaPipeline, type MediaDeps, mediaRoutes } from "./routes/media";
import { productsRoutes } from "./routes/products";
import { referenceRoutes } from "./routes/reference";
import { sharedRoutes } from "./routes/shared";
import { shopsRoutes } from "./routes/shops";
import { type TestMailDeps, testMailRoutes } from "./routes/test-mail";
import type { WardrobeDeps } from "./wardrobe/deps";
import { createImportAttacher } from "./wardrobe/photo-imports";

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
  /** Web Push (alerts); without it, push is off. */
  push?: PushDeps;
  /** dev.closyria.com's access page (`POST /api/dev-access`). Never given in prod. */
  devAccess?: DevAccessDeps;
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
  // Fail closed: prod is open to everyone, the dev access route must never exist there.
  if (deps.devAccess && deps.env === "prod") throw new Error("devAccess is never available with APP_ENV=prod");
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
  // Item reads and the import poll both attach photos imported by link (a closed dialog never loses one).
  const importAttacher = createImportAttacher({
    db: deps.wardrobe.db,
    store: deps.media.store,
    pipeline: mediaPipeline,
    ...(deps.wardrobe.now ? { now: deps.wardrobe.now } : {}),
  });
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
    .route("/", shopsRoutes(deps.catalog))
    .route("/", catalogueRoutes(deps.catalog))
    .route("/", eventsRoutes(deps.events))
    .route("/", profilesRoutes(deps.wardrobe))
    .route("/", loveLevelsRoutes(deps.wardrobe))
    .route("/", preferencesRoutes(deps.wardrobe))
    .route("/", changesRoutes(deps.wardrobe))
    .route("/", bulkRoutes(deps.wardrobe))
    .route("/", giftsRoutes(deps.wardrobe))
    .route("/", orderDraftRoutes(deps.wardrobe))
    .route("/", itemsRoutes(deps.wardrobe, importAttacher))
    .route(
      "/",
      itemMediaRoutes(
        { ...deps.wardrobe, store: deps.media.store, queue: deps.catalog.queue },
        mediaPipeline,
        importAttacher,
      ),
    )
    .route("/", tagsRoutes(deps.wardrobe))
    .route("/", recentsRoutes(deps.wardrobe))
    .route("/", facetsRoutes(deps.wardrobe))
    .route("/", homeRoutes(deps.wardrobe))
    .route("/", referenceRoutes(deps.wardrobe))
    .route("/", wishlistsRoutes(deps.wardrobe))
    .route("/", groupOrdersRoutes({ ...deps.wardrobe, queue: deps.catalog.queue }, captureLimiter))
    .route("/", budgetsRoutes(deps.wardrobe))
    .route("/", alertsRoutes(deps.wardrobe, deps.push ?? { publicKey: null }))
    .route("/", sharedRoutes({ ...deps.wardrobe, queue: deps.catalog.queue }))
    .route("/", overviewRoutes(deps.admin))
    .route("/", auditRoutes(deps.admin))
    .route("/", adminShopsRoutes(deps.catalog))
    .route("/", adminShippingOptionsRoutes(deps.catalog))
    .route("/", adminSalesRoutes(deps.admin))
    .route("/", adminCapturesRoutes(deps.catalog))
    .route("/", adminProductsRoutes(deps.catalog))
    .route("/", adminReferenceRoutes(deps.catalog))
    .route("/", adminCatalogueRoutes(deps.catalog))
    .route("/", adminUsersRoutes({ db: deps.admin.db, store: deps.media.store }));

  // Not part of AppType: no client calls it, and it is absent from every real environment.
  if (deps.testMail) app.route("/", testMailRoutes(deps.testMail));
  // Not part of AppType either: only dev.closyria.com has it (DEV_ACCESS_*), and the page calls it with fetch.
  if (deps.devAccess) app.route("/", devAccessRoutes(deps.devAccess));

  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Closyria API", version: deps.version },
  });

  return routes;
}

export type AppType = ReturnType<typeof createApp>;
