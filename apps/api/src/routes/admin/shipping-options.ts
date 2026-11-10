import { and, desc, eq, isNull, schema } from "@closyria/db";
import {
  adminCatalogErrorSchema,
  shippingOptionInputSchema,
  shippingOptionListSchema,
  shippingOptionSchema,
} from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { defineAccess } from "../../access";
import { type AdminEnv, noteAudit } from "../../admin-audit";
import type { CatalogDeps } from "../../catalog/deps";
import { listShippingOptions, shapeShippingOption } from "../../catalog/shipping-options";

const invalidRequest = { error: "invalid_request" } as const;
const notFound = { error: "not_found" } as const;
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: adminCatalogErrorSchema } },
});
const shopParam = z.object({ id: z.uuid() });
const optionParam = z.object({ id: z.uuid(), optionId: z.uuid() });
const json = <S extends z.ZodType>(schema: S) => ({ required: true, content: { "application/json": { schema } } });

const listRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/admin/shops/{id}/shipping-options",
    summary: "A shop's delivery options, in order",
    request: { params: shopParam },
    responses: {
      200: { description: "Options", content: { "application/json": { schema: shippingOptionListSchema } } },
      404: errorContent("Unknown or merged shop"),
    },
  }),
  "admin",
);

const createOptionRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/admin/shops/{id}/shipping-options",
    summary: "Add a delivery option, after the existing ones",
    request: { params: shopParam, body: json(shippingOptionInputSchema) },
    responses: {
      201: { description: "Created", content: { "application/json": { schema: shippingOptionSchema } } },
      400: errorContent("Invalid body"),
      404: errorContent("Unknown or merged shop"),
    },
  }),
  "admin",
);

const patchOptionRoute = defineAccess(
  createRoute({
    method: "patch",
    path: "/admin/shops/{id}/shipping-options/{optionId}",
    summary: "Edit a delivery option",
    description: "Group orders already opened keep the values they copied.",
    request: { params: optionParam, body: json(shippingOptionInputSchema) },
    responses: {
      200: { description: "The option", content: { "application/json": { schema: shippingOptionSchema } } },
      400: errorContent("Invalid body"),
      404: errorContent("Unknown option"),
    },
  }),
  "admin",
);

const deleteOptionRoute = defineAccess(
  createRoute({
    method: "delete",
    path: "/admin/shops/{id}/shipping-options/{optionId}",
    summary: "Delete a delivery option",
    request: { params: optionParam },
    responses: {
      204: { description: "Deleted" },
      404: errorContent("Unknown option"),
    },
  }),
  "admin",
);

export function adminShippingOptionsRoutes(deps: CatalogDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const app = new OpenAPIHono<AdminEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });
  const shopExists = async (id: string) => {
    const [shop] = await db
      .select({ id: schema.shops.id })
      .from(schema.shops)
      .where(and(eq(schema.shops.id, id), isNull(schema.shops.mergedIntoId)));
    return shop !== undefined;
  };

  return app
    .openapi(listRoute, async (c) => {
      const { id } = c.req.valid("param");
      if (!(await shopExists(id))) return c.json(notFound, 404);
      return c.json({ options: await listShippingOptions(db, id) }, 200);
    })
    .openapi(createOptionRoute, async (c) => {
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      noteAudit(c, { action: "shipping.create", target: `shop:${id}`, details: { label: input.label } });
      const created = await db.transaction(async (tx) => {
        // The shop row serialises two creations, so positions never collide.
        const [shop] = await tx
          .select({ id: schema.shops.id })
          .from(schema.shops)
          .where(and(eq(schema.shops.id, id), isNull(schema.shops.mergedIntoId)))
          .for("update");
        if (!shop) return null;
        const [last] = await tx
          .select({ top: schema.shopShippingOptions.position })
          .from(schema.shopShippingOptions)
          .where(eq(schema.shopShippingOptions.shopId, id))
          .orderBy(desc(schema.shopShippingOptions.position))
          .limit(1);
        const [row] = await tx
          .insert(schema.shopShippingOptions)
          .values({ shopId: id, ...input, position: (last?.top ?? -1) + 1 })
          .returning();
        return row ?? null;
      });
      if (!created) return c.json(notFound, 404);
      return c.json(shapeShippingOption(created), 201);
    })
    .openapi(patchOptionRoute, async (c) => {
      const { id, optionId } = c.req.valid("param");
      const input = c.req.valid("json");
      noteAudit(c, { action: "shipping.update", target: `shop:${id}`, details: { optionId } });
      const [row] = await db
        .update(schema.shopShippingOptions)
        .set({ ...input, updatedAt: now() })
        .where(and(eq(schema.shopShippingOptions.id, optionId), eq(schema.shopShippingOptions.shopId, id)))
        .returning();
      if (!row) return c.json(notFound, 404);
      return c.json(shapeShippingOption(row), 200);
    })
    .openapi(deleteOptionRoute, async (c) => {
      const { id, optionId } = c.req.valid("param");
      noteAudit(c, { action: "shipping.delete", target: `shop:${id}`, details: { optionId } });
      const rows = await db
        .delete(schema.shopShippingOptions)
        .where(and(eq(schema.shopShippingOptions.id, optionId), eq(schema.shopShippingOptions.shopId, id)))
        .returning({ id: schema.shopShippingOptions.id });
      if (rows.length === 0) return c.json(notFound, 404);
      return c.body(null, 204);
    });
}
