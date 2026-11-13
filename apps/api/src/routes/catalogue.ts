import {
  catalogDetailQuerySchema,
  catalogDetailSchema,
  catalogPageSchema,
  catalogQuerySchema,
  reportInputSchema,
} from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import { type AccessEnv, defineAccess } from "../access";
import {
  CATALOG_DETAIL_LIMITS,
  CATALOG_PAGE_SIZE,
  InvalidCatalogCursorError,
  LIKES_THRESHOLD,
  listCatalog,
  loadCatalogDetail,
  loadViewer,
  NEW_DAYS,
  reportProduct,
} from "../catalog/catalogue";
import type { CatalogDeps } from "../catalog/deps";
import { rateLimit } from "../rate-limit";

/** Reports a person may send in an hour. */
export const REPORTS_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;

const catalogErrorSchema = z.object({
  error: z.enum(["invalid_request", "invalid_cursor", "not_found", "rate_limited"]),
});
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: catalogErrorSchema } },
});
const json = <S extends z.ZodType>(description: string, schema: S) => ({
  description,
  content: { "application/json": { schema } },
});
const productParams = z.object({ productId: z.uuid() });
const notFound = { error: "not_found" } as const;

const listRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/catalog",
    summary: "The catalogue of « Découvrir »",
    description:
      `${CATALOG_PAGE_SIZE} visible articles per page (published shop, not hidden, not removed, with a photo and a ` +
      "price); `nextCursor` gives the next page of the same sort. `sort`: `new` (first seen), `price_asc`, " +
      "`price_desc`, `popular` (the most kept, then the newest). `q` looks for every word (prefix, accents and case " +
      "aside) in the name, brand, shop, category or color. `priceMin`/`priceMax` in cents; `values` keeps the shops " +
      `that claim all of them; \`onSale\`: a crossed price above the price; \`isNew\`: first seen less than ${NEW_DAYS} ` +
      "days ago; `mySize`: leaves out the articles not available in her size (sizes of `profile`, else of her first " +
      "profile; articles with no kind of size are kept). `wanted` and `sizeInStock` are hers only.",
    request: { query: catalogQuerySchema },
    responses: {
      200: json("A page", catalogPageSchema),
      400: errorContent("Invalid query (invalid_request) or cursor (invalid_cursor)"),
    },
  }),
  "user",
);

const detailRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/catalog/{productId}",
    summary: "The sheet of a catalogue article",
    description:
      "Photos, sizes, her own item on it, and `likes`: how many people keep it, null under " +
      `${LIKES_THRESHOLD} (never who). \`close\`: up to ${CATALOG_DETAIL_LIMITS.close} of her own owned pieces ` +
      "(« Reçu », « Dans mon dressing ») of `profile` (else her first) with the same category and color; " +
      `\`sameShop\` up to ${CATALOG_DETAIL_LIMITS.sameShop}, \`sameStyle\` up to ` +
      `${CATALOG_DETAIL_LIMITS.sameStyle} from other shops (same category, color or a price within 20 %).`,
    request: { params: productParams, query: catalogDetailQuerySchema },
    responses: {
      200: json("The sheet", catalogDetailSchema),
      400: errorContent("Malformed id or query (invalid_request)"),
      404: errorContent("Unknown or not visible in the catalogue (not_found)"),
    },
  }),
  "user",
);

const reportRoute = (limiter: MiddlewareHandler<AccessEnv>) =>
  defineAccess(
    createRoute({
      method: "post",
      path: "/catalog/{productId}/report",
      middleware: [limiter] as const,
      summary: "Report a catalogue article",
      description: `One report per person and article (a new one changes nothing). ${REPORTS_PER_HOUR} an hour per person.`,
      request: {
        params: productParams,
        body: { required: true, content: { "application/json": { schema: reportInputSchema } } },
      },
      responses: {
        204: { description: "Recorded" },
        400: errorContent("Invalid body (invalid_request)"),
        404: errorContent("Unknown or not visible in the catalogue (not_found)"),
        429: errorContent(`Over ${REPORTS_PER_HOUR} reports this hour (rate_limited)`),
      },
    }),
    "user",
  );

const userIdOf = (c: Context<AccessEnv>) => {
  const session = c.var.session;
  if (!session) throw new Error("session expected on a user route");
  return session.user.id;
};

export function catalogueRoutes(deps: CatalogDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json({ error: "invalid_request" } as const, 400)),
  });
  const reportLimiter = rateLimit<AccessEnv>(
    { max: REPORTS_PER_HOUR, windowMs: HOUR_MS, key: (c) => `report:${c.var.session?.user.id ?? ""}` },
    (c) => c.json({ error: "rate_limited" } as const, 429),
  );

  return app
    .openapi(listRoute, async (c) => {
      const query = c.req.valid("query");
      c.header("Cache-Control", "private, no-cache");
      try {
        const viewer = await loadViewer(db, userIdOf(c), query.profile);
        return c.json(await listCatalog(db, viewer, query, now()), 200);
      } catch (error) {
        if (error instanceof InvalidCatalogCursorError) return c.json({ error: "invalid_cursor" } as const, 400);
        throw error;
      }
    })
    .openapi(detailRoute, async (c) => {
      const { productId } = c.req.valid("param");
      const viewer = await loadViewer(db, userIdOf(c), c.req.valid("query").profile);
      const sheet = await loadCatalogDetail(db, viewer, productId);
      c.header("Cache-Control", "private, no-cache");
      return sheet ? c.json(sheet, 200) : c.json(notFound, 404);
    })
    .openapi(reportRoute(reportLimiter), async (c) => {
      const { productId } = c.req.valid("param");
      const recorded = await reportProduct(db, userIdOf(c), productId, c.req.valid("json").reason);
      return recorded ? c.body(null, 204) : c.json(notFound, 404);
    });
}
