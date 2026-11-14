import { and, desc, eq, schema } from "@closyria/db";
import {
  ADMIN_FAILURES_LIMIT,
  adminCaptureAcceptedSchema,
  adminCaptureFailuresSchema,
  adminCaptureSchema,
  adminCaptureTestSchema,
  adminCatalogErrorSchema,
  CAPTURE_QUEUES,
  type CaptureErrorCode,
  type CaptureMethod,
  type CaptureStatus,
  type CaptureTrigger,
  canonicalizeUrl,
  captureErrorCodeSchema,
} from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { defineAccess } from "../../access";
import { type AdminEnv, noteAudit } from "../../admin-audit";
import type { CatalogDeps } from "../../catalog/deps";
import { enqueueCapture } from "../../catalog/enqueue";
import { findOrCreateShop } from "../../catalog/shops";

const invalidRequest = { error: "invalid_request" } as const;
const notFound = { error: "not_found" } as const;
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: adminCatalogErrorSchema } },
});
const idParam = z.object({ id: z.uuid() });

const testRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/admin/captures/test",
    summary: "Test a link without creating a product",
    description: "The shop of the link is found, or created `pending`. The capture waits on the admin queue.",
    request: { body: { required: true, content: { "application/json": { schema: adminCaptureTestSchema } } } },
    responses: {
      202: { description: "Accepted", content: { "application/json": { schema: adminCaptureAcceptedSchema } } },
      400: errorContent("invalid_url or invalid_request"),
    },
  }),
  "admin",
);

const failuresRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/admin/captures/failures",
    summary: `The ${ADMIN_FAILURES_LIMIT} latest failed captures`,
    request: { query: z.object({ shopId: z.uuid().optional(), errorCode: captureErrorCodeSchema.optional() }) },
    responses: {
      200: { description: "Failures", content: { "application/json": { schema: adminCaptureFailuresSchema } } },
      400: errorContent("Invalid filter"),
    },
  }),
  "admin",
);

const getRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/admin/captures/{id}",
    summary: "A capture: status, method, duration, error and result",
    request: { params: idParam },
    responses: {
      200: { description: "The capture", content: { "application/json": { schema: adminCaptureSchema } } },
      404: errorContent("Unknown capture"),
    },
  }),
  "admin",
);

const retryRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/admin/captures/{id}/retry",
    summary: "Capture the same address again",
    description:
      "A new capture with the same trigger, product, shop and address. `user` captures go back to the user queue, " +
      "`revisit` ones to the revisit queue, the others to the admin queue.",
    request: { params: idParam },
    responses: {
      202: { description: "Accepted", content: { "application/json": { schema: adminCaptureAcceptedSchema } } },
      404: errorContent("Unknown capture"),
      409: errorContent("capture_active: only a finished (succeeded or failed) capture can be retried"),
    },
  }),
  "admin",
);

export function adminCapturesRoutes(deps: CatalogDeps) {
  const { db, queue } = deps;
  const now = deps.now ?? (() => new Date());
  const app = new OpenAPIHono<AdminEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });

  // `failures` is declared before `{id}`: the static path wins.
  return app
    .openapi(testRoute, async (c) => {
      noteAudit(c, { action: "capture.test" });
      const url = canonicalizeUrl(c.req.valid("json").url);
      if (!url) return c.json({ error: "invalid_url" } as const, 400);
      const shop = await findOrCreateShop(db, url);
      const [capture] = await db
        .insert(schema.captures)
        .values({ shopId: shop.id, productId: null, url, trigger: "admin_test", status: "queued" })
        .returning();
      if (!capture) throw new Error("capture not created");
      noteAudit(c, { action: "capture.test", target: `capture:${capture.id}`, details: { shopId: shop.id } });
      await enqueueCapture(db, queue, "capture-admin", capture.id, now());
      return c.json({ captureId: capture.id, shopId: shop.id }, 202);
    })
    .openapi(failuresRoute, async (c) => {
      const { shopId, errorCode } = c.req.valid("query");
      const rows = await db
        .select({ capture: schema.captures, shopName: schema.shops.name })
        .from(schema.captures)
        .innerJoin(schema.shops, eq(schema.shops.id, schema.captures.shopId))
        .where(
          and(
            eq(schema.captures.status, "failed"),
            shopId ? eq(schema.captures.shopId, shopId) : undefined,
            errorCode ? eq(schema.captures.errorCode, errorCode) : undefined,
          ),
        )
        .orderBy(desc(schema.captures.createdAt), desc(schema.captures.id))
        .limit(ADMIN_FAILURES_LIMIT);
      return c.json(
        {
          failures: rows.map(({ capture, shopName }) => ({
            id: capture.id,
            shopId: capture.shopId,
            shopName,
            productId: capture.productId,
            url: capture.url,
            trigger: capture.trigger as CaptureTrigger,
            errorCode: capture.errorCode as CaptureErrorCode | null,
            httpStatus: capture.httpStatus,
            createdAt: capture.createdAt.toISOString(),
          })),
        },
        200,
      );
    })
    .openapi(getRoute, async (c) => {
      const { id } = c.req.valid("param");
      const [capture] = await db.select().from(schema.captures).where(eq(schema.captures.id, id));
      if (!capture) return c.json(notFound, 404);
      return c.json(
        {
          id: capture.id,
          shopId: capture.shopId,
          productId: capture.productId,
          url: capture.url,
          trigger: capture.trigger as CaptureTrigger,
          status: capture.status as CaptureStatus,
          method: capture.method as CaptureMethod | null,
          durationMs: capture.durationMs,
          errorCode: capture.errorCode as CaptureErrorCode | null,
          httpStatus: capture.httpStatus,
          result: capture.result ?? null,
          createdAt: capture.createdAt.toISOString(),
          finishedAt: capture.finishedAt?.toISOString() ?? null,
        },
        200,
      );
    })
    .openapi(retryRoute, async (c) => {
      const { id } = c.req.valid("param");
      noteAudit(c, { action: "capture.retry", target: `capture:${id}` });
      const [original] = await db.select().from(schema.captures).where(eq(schema.captures.id, id));
      if (!original) return c.json(notFound, 404);
      if (original.status !== "succeeded" && original.status !== "failed") {
        return c.json({ error: "capture_active" } as const, 409);
      }
      const [capture] = await db
        .insert(schema.captures)
        .values({
          shopId: original.shopId,
          productId: original.productId,
          url: original.url,
          trigger: original.trigger,
          requestedBy: original.requestedBy,
          status: "queued",
        })
        .returning();
      if (!capture) throw new Error("capture not created");
      noteAudit(c, { action: "capture.retry", target: `capture:${id}`, details: { captureId: capture.id } });
      await enqueueCapture(
        db,
        queue,
        original.trigger === "user"
          ? CAPTURE_QUEUES.user
          : original.trigger === "revisit"
            ? CAPTURE_QUEUES.revisit
            : CAPTURE_QUEUES.admin,
        capture.id,
        now(),
      );
      return c.json({ captureId: capture.id, shopId: capture.shopId }, 202);
    });
}
