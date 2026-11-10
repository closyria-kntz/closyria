import { eq, schema } from "@closyria/db";
import { canonicalizeUrl, captureAcceptedSchema, captureViewSchema, catalogErrorSchema } from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type AccessEnv, defineAccess } from "../access";
import type { CatalogDeps } from "../catalog/deps";
import { requestProductCapture } from "../catalog/product-capture";
import { loadProductView } from "../catalog/product-view";
import { findOrCreateShop } from "../catalog/shops";

const invalidUrl = { error: "invalid_url" } as const;
const invalidRequest = { error: "invalid_request" } as const;
const notFound = { error: "not_found" } as const;
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: catalogErrorSchema } },
});

const createCaptureRoute = (limiter: MiddlewareHandler<AccessEnv>) =>
  defineAccess(
    createRoute({
      method: "post",
      path: "/captures",
      summary: "Capture a product from a pasted link",
      description:
        "Finds or creates the shop and the shared product page of the link, then queues a capture for the worker " +
        "unless the page was captured less than 24 hours ago or the shop is captured by hand.",
      middleware: [limiter, bodyLimit({ maxSize: 32 * 1024, onError: (c) => c.json(invalidRequest, 400) })],
      request: {
        body: { required: true, content: { "application/json": { schema: z.object({ url: z.string() }) } } },
      },
      responses: {
        202: { description: "Accepted", content: { "application/json": { schema: captureAcceptedSchema } } },
        400: errorContent("Not an http(s) address (invalid_url) or a malformed body (invalid_request)"),
        429: errorContent("Too many captures: 30 an hour anonymous, 100 with an account, 200 per address"),
      },
    }),
    "user",
  );

const getCaptureRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/captures/{id}",
    summary: "Capture status and the product page",
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: { description: "The capture", content: { "application/json": { schema: captureViewSchema } } },
      400: errorContent("Malformed id (invalid_request)"),
      404: errorContent("Unknown capture (not_found)"),
    },
  }),
  "user",
);

export function capturesRoutes(deps: CatalogDeps, limiter: MiddlewareHandler<AccessEnv>) {
  const { db, queue } = deps;
  const now = deps.now ?? (() => new Date());
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });

  return app
    .openapi(createCaptureRoute(limiter), async (c) => {
      const userId = c.var.session?.user.id;
      if (!userId) throw new Error("capture route reached without a session");
      const url = canonicalizeUrl(c.req.valid("json").url);
      if (!url) return c.json(invalidUrl, 400);

      const shop = await findOrCreateShop(db, url);
      const capture = await requestProductCapture(db, queue, {
        url,
        shop,
        requestedBy: userId,
        now,
        // « Derniers liens »: every outcome counts as a visit. A failure here never fails the capture.
        beforeEnqueue: async (productId) => {
          try {
            await db
              .insert(schema.recentProducts)
              .values({ userId, productId, visitedAt: now() })
              .onConflictDoUpdate({
                target: [schema.recentProducts.userId, schema.recentProducts.productId],
                set: { visitedAt: now() },
              });
          } catch (error) {
            console.error("recent product not recorded:", error);
          }
        },
      });
      return c.json(
        { productId: capture.productId, captureId: capture.captureId, status: capture.status as "queued" },
        202,
      );
    })
    .openapi(getCaptureRoute, async (c) => {
      const { id } = c.req.valid("param");
      const [capture] = await db.select().from(schema.captures).where(eq(schema.captures.id, id));
      if (!capture) return c.json(notFound, 404);
      const product = capture.productId ? await loadProductView(db, capture.productId) : null;
      return c.json(
        captureViewSchema.parse({
          id: capture.id,
          status: capture.status,
          dataReady: capture.dataReady,
          errorCode: capture.errorCode,
          product,
        }),
        200,
      );
    });
}
