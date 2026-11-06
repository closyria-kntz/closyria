import { and, desc, eq, inArray, schema, sql } from "@closyria/db";
import { canonicalizeUrl, captureAcceptedSchema, captureViewSchema, catalogErrorSchema } from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type AccessEnv, defineAccess } from "../access";
import type { CatalogDeps } from "../catalog/deps";
import { loadProductView } from "../catalog/product-view";
import { findOrCreateShop } from "../catalog/shops";

const FRESH_MS = 24 * 60 * 60 * 1000;

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
      // Two people pasting the same new link: one insert wins, the other re-reads.
      await db
        .insert(schema.products)
        .values({ shopId: shop.id, canonicalUrl: url })
        .onConflictDoNothing({ target: schema.products.canonicalUrl });
      const [product] = await db.select().from(schema.products).where(eq(schema.products.canonicalUrl, url));
      if (!product) throw new Error("product vanished after insert");

      const at = now();
      const fresh =
        product.captureStatus === "ok" &&
        product.lastCapturedAt !== null &&
        at.getTime() - product.lastCapturedAt.getTime() < FRESH_MS;
      const base = { productId: product.id, shopId: shop.id, url, trigger: "user", requestedBy: userId } as const;

      const outcome = await db.transaction(async (tx) => {
        // One capture at a time per product, whoever asks.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${product.id}, 0))`);
        if (shop.captureMode === "manual") {
          const [capture] = await tx
            .insert(schema.captures)
            .values({ ...base, status: "skipped_manual", finishedAt: at })
            .returning();
          await tx
            .update(schema.products)
            .set({ captureStatus: "manual", updatedAt: at })
            .where(
              and(eq(schema.products.id, product.id), inArray(schema.products.captureStatus, ["pending", "failed"])),
            );
          return { capture, enqueue: false };
        }
        if (fresh) {
          const [capture] = await tx
            .insert(schema.captures)
            .values({ ...base, status: "succeeded", dataReady: true, finishedAt: at })
            .returning();
          return { capture, enqueue: false };
        }
        const [active] = await tx
          .select()
          .from(schema.captures)
          .where(and(eq(schema.captures.productId, product.id), inArray(schema.captures.status, ["queued", "running"])))
          .orderBy(desc(schema.captures.createdAt))
          .limit(1);
        if (active) return { capture: active, enqueue: false };
        const [capture] = await tx
          .insert(schema.captures)
          .values({ ...base, status: "queued" })
          .returning();
        return { capture, enqueue: true };
      });
      const { capture } = outcome;
      if (!capture) throw new Error("capture not created");

      // « Derniers liens »: every outcome counts as a visit. A failure here never fails the capture.
      try {
        await db
          .insert(schema.recentProducts)
          .values({ userId, productId: product.id, visitedAt: now() })
          .onConflictDoUpdate({
            target: [schema.recentProducts.userId, schema.recentProducts.productId],
            set: { visitedAt: now() },
          });
      } catch (error) {
        console.error("recent product not recorded:", error);
      }

      if (outcome.enqueue) {
        try {
          await queue.enqueue("capture-user", capture.id);
        } catch (error) {
          // Keep the row: another request may already have been given this capture id. A failed capture
          // does not block the next attempt on this page.
          await db
            .update(schema.captures)
            .set({ status: "failed", errorCode: "queue_unavailable", finishedAt: now() })
            .where(eq(schema.captures.id, capture.id));
          throw error;
        }
      }
      return c.json({ productId: product.id, captureId: capture.id, status: capture.status as "queued" }, 202);
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
