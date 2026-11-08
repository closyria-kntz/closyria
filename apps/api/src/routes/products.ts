import { and, asc, eq, gte, schema } from "@closyria/db";
import { catalogErrorSchema, manualEntrySchema, priceHistorySchema, productViewSchema } from "@closyria/shared";
import { ObjectNotFoundError } from "@closyria/storage";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { type AccessEnv, defineAccess } from "../access";
import type { CatalogDeps } from "../catalog/deps";
import { loadProductView } from "../catalog/product-view";

const invalidRequest = { error: "invalid_request" } as const;
const notFound = { error: "not_found" } as const;
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: catalogErrorSchema } },
});
const idParams = z.object({ id: z.uuid() });

const getProductRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/products/{id}",
    summary: "A product page",
    request: { params: idParams },
    responses: {
      200: { description: "The product", content: { "application/json": { schema: productViewSchema } } },
      400: errorContent("Malformed id (invalid_request)"),
      404: errorContent("Unknown product (not_found)"),
    },
  }),
  "public",
);

const historyQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(90),
});

const priceHistoryRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/products/{id}/price-history",
    summary: "A product's price history",
    description:
      "Captured prices of the last `days` days (integer 1 to 365, default 90). Days are UTC dates. " +
      "`points` holds at most one point per day (the last capture of that day), oldest first; `at` is the capture " +
      "time (ISO 8601) and prices are integer cents. `dropCents` is the latest price minus the previous different " +
      "price, only when negative (otherwise null), and `dropSince` the ISO date of the point where that latest " +
      "price first appeared. `lowestSinceDays` is the number of days between today and the most recent point " +
      "(before the latest price's run) whose price was as low as or lower than the current one; when the current " +
      "price is the lowest of the window it is the age of the oldest point. A product with no history, or a " +
      "manual one (captureStatus manual), answers `points: []` and nulls.",
    request: { params: idParams, query: historyQuery },
    responses: {
      200: { description: "The price history", content: { "application/json": { schema: priceHistorySchema } } },
      400: errorContent("Malformed id or days (invalid_request)"),
      404: errorContent("Unknown product (not_found)"),
    },
  }),
  "public",
);

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

const manualRoute = (limiter: MiddlewareHandler<AccessEnv>) =>
  defineAccess(
    createRoute({
      method: "put",
      path: "/products/{id}/manual",
      summary: "Complete a product page by hand",
      description:
        "Fills only the empty fields: the name, the price (in EUR) and the sizes when there are none. A page with " +
        "no captured data becomes a manual one. Counts in the same limits as the captures.",
      middleware: [limiter],
      request: {
        params: idParams,
        body: { required: true, content: { "application/json": { schema: manualEntrySchema } } },
      },
      responses: {
        200: { description: "The product", content: { "application/json": { schema: productViewSchema } } },
        400: errorContent("Malformed id or body (invalid_request)"),
        404: errorContent("Unknown product (not_found)"),
        429: errorContent("Too many captures (rate_limited)"),
      },
    }),
    "user",
  );

const imageRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/catalog-images/{id}",
    summary: "A catalog photo",
    request: { params: idParams },
    responses: {
      200: {
        description: "The WebP photo",
        content: { "image/webp": { schema: z.string().openapi({ format: "binary" }) } },
      },
      400: errorContent("Malformed id (invalid_request)"),
      404: errorContent("Unknown photo (not_found)"),
    },
  }),
  "public",
);

export function productsRoutes(deps: CatalogDeps, limiter: MiddlewareHandler<AccessEnv>) {
  const { db, store } = deps;
  const now = deps.now ?? (() => new Date());
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });

  return app
    .openapi(getProductRoute, async (c) => {
      const view = await loadProductView(db, c.req.valid("param").id);
      return view ? c.json(view, 200) : c.json(notFound, 404);
    })
    .openapi(priceHistoryRoute, async (c) => {
      const { id } = c.req.valid("param");
      const { days } = c.req.valid("query");
      const [product] = await db
        .select({ captureStatus: schema.products.captureStatus })
        .from(schema.products)
        .where(eq(schema.products.id, id));
      if (!product) return c.json(notFound, 404);
      const empty = { points: [], lowestSinceDays: null, dropCents: null, dropSince: null };
      if (product.captureStatus === "manual") return c.json(empty, 200);
      const current = now();
      const rows = await db
        .select({ seenAt: schema.productHistory.seenAt, priceCents: schema.productHistory.priceCents })
        .from(schema.productHistory)
        .where(
          and(
            eq(schema.productHistory.productId, id),
            gte(schema.productHistory.seenAt, new Date(current.getTime() - days * 86_400_000)),
          ),
        )
        .orderBy(asc(schema.productHistory.seenAt));
      const byDay = new Map<string, { at: Date; priceCents: number }>();
      for (const row of rows) byDay.set(dayOf(row.seenAt), { at: row.seenAt, priceCents: row.priceCents });
      const kept = [...byDay.values()];
      const latest = kept.at(-1);
      if (!latest) return c.json(empty, 200);
      const dayDiff = (d: Date) => Math.round((Date.parse(dayOf(current)) - Date.parse(dayOf(d))) / 86_400_000);
      let runStart = kept.length - 1;
      while (runStart > 0 && kept[runStart - 1]?.priceCents === latest.priceCents) runStart -= 1;
      const before = kept.slice(0, runStart);
      const previous = before.at(-1);
      const drop = previous ? latest.priceCents - previous.priceCents : 0;
      const lower = before.findLast((point) => point.priceCents <= latest.priceCents);
      const lowestSince = lower ?? kept[0];
      return c.json(
        {
          points: kept.map((point) => ({ at: point.at.toISOString(), priceCents: point.priceCents })),
          lowestSinceDays: lowestSince ? dayDiff(lowestSince.at) : null,
          dropCents: drop < 0 ? drop : null,
          dropSince: drop < 0 ? dayOf((kept[runStart] ?? latest).at) : null,
        },
        200,
      );
    })
    .openapi(manualRoute(limiter), async (c) => {
      const { id } = c.req.valid("param");
      const entry = c.req.valid("json");
      const at = now();
      const found = await db.transaction(async (tx) => {
        const [product] = await tx.select().from(schema.products).where(eq(schema.products.id, id)).for("update");
        if (!product) return false;
        const patch: Partial<typeof schema.products.$inferInsert> = {};
        if (product.name === null) patch.name = entry.name;
        if (product.priceCents === null && entry.priceCents !== undefined) {
          patch.priceCents = entry.priceCents;
          patch.currency = "EUR";
        }
        if (product.lastCapturedAt === null) patch.source = "manual";
        if (Object.keys(patch).length > 0) {
          await tx
            .update(schema.products)
            .set({ ...patch, updatedAt: at })
            .where(eq(schema.products.id, id));
        }
        const existing = await tx
          .select({ label: schema.productSizes.label })
          .from(schema.productSizes)
          .where(eq(schema.productSizes.productId, id))
          .limit(1);
        const labels = [...new Set(entry.sizes)];
        if (existing.length === 0 && labels.length > 0) {
          await tx
            .insert(schema.productSizes)
            .values(labels.map((label, position) => ({ productId: id, label, position, available: true })));
        }
        return true;
      });
      if (!found) return c.json(notFound, 404);
      const view = await loadProductView(db, id);
      return view ? c.json(view, 200) : c.json(notFound, 404);
    })
    .openapi(imageRoute, async (c) => {
      const [image] = await db
        .select({ key: schema.productImages.key })
        .from(schema.productImages)
        .where(eq(schema.productImages.id, c.req.valid("param").id));
      if (!image) return c.json(notFound, 404);
      let body: Buffer;
      try {
        body = await store.get(image.key);
      } catch (error) {
        if (error instanceof ObjectNotFoundError) return c.json(notFound, 404);
        throw error;
      }
      return c.body(new Uint8Array(body), 200, {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
      });
    });
}
