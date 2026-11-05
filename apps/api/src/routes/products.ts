import { eq, schema } from "@closyria/db";
import { catalogErrorSchema, manualEntrySchema, productViewSchema } from "@closyria/shared";
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
