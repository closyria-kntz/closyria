import { desc, eq, schema } from "@closyria/db";
import {
  adminCatalogErrorSchema,
  type SalePeriod,
  salePeriodInputSchema,
  salePeriodListSchema,
  salePeriodSchema,
} from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { defineAccess } from "../../access";
import { type AdminEnv, noteAudit } from "../../admin-audit";
import type { AdminDeps } from "./overview";

const invalidRequest = { error: "invalid_request" } as const;
const notFound = { error: "not_found" } as const;
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: adminCatalogErrorSchema } },
});
const idParam = z.object({ id: z.uuid() });
const body = { required: true, content: { "application/json": { schema: salePeriodInputSchema } } };

const listRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/admin/sale-periods",
    summary: "The sales periods, the latest start first",
    responses: {
      200: { description: "Periods", content: { "application/json": { schema: salePeriodListSchema } } },
    },
  }),
  "admin",
);

const createPeriodRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/admin/sale-periods",
    summary: "Add a sales period",
    description:
      "First and last day included (Paris), the end on or after the start. Its notice goes to every person with a " +
      "followed wish 2 days before the start and on the day (worker, every morning).",
    request: { body },
    responses: {
      201: { description: "Created", content: { "application/json": { schema: salePeriodSchema } } },
      400: errorContent("Invalid body (empty or too long name, bad date, end before the start)"),
    },
  }),
  "admin",
);

const patchPeriodRoute = defineAccess(
  createRoute({
    method: "patch",
    path: "/admin/sale-periods/{id}",
    summary: "Edit a sales period",
    description: "A notice already given for this period is not given again on the same day.",
    request: { params: idParam, body },
    responses: {
      200: { description: "The period", content: { "application/json": { schema: salePeriodSchema } } },
      400: errorContent("Invalid body"),
      404: errorContent("Unknown period"),
    },
  }),
  "admin",
);

const deletePeriodRoute = defineAccess(
  createRoute({
    method: "delete",
    path: "/admin/sale-periods/{id}",
    summary: "Delete a sales period",
    description: "Its notices (alert events) go with it, also from « Nouvelles ».",
    request: { params: idParam },
    responses: {
      204: { description: "Deleted" },
      404: errorContent("Unknown period"),
    },
  }),
  "admin",
);

const shape = (row: typeof schema.salePeriods.$inferSelect): SalePeriod => ({
  id: row.id,
  name: row.name,
  startsOn: row.startsOn,
  endsOn: row.endsOn,
});

/** Admin « Soldes » (spec §6): the sales periods the daily notice reads. Every change is journalled. */
export function adminSalesRoutes(deps: AdminDeps) {
  const { db } = deps;
  const app = new OpenAPIHono<AdminEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });
  const { salePeriods } = schema;

  return app
    .openapi(listRoute, async (c) => {
      const rows = await db
        .select()
        .from(salePeriods)
        .orderBy(desc(salePeriods.startsOn), desc(salePeriods.endsOn), salePeriods.name);
      return c.json({ periods: rows.map(shape) }, 200);
    })
    .openapi(createPeriodRoute, async (c) => {
      const input = c.req.valid("json");
      const [row] = await db.insert(salePeriods).values(input).returning();
      if (!row) throw new Error("The sales period was not created");
      noteAudit(c, { action: "sale_period.create", target: `sale_period:${row.id}`, details: { ...input } });
      return c.json(shape(row), 201);
    })
    .openapi(patchPeriodRoute, async (c) => {
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      noteAudit(c, { action: "sale_period.update", target: `sale_period:${id}`, details: { ...input } });
      const [row] = await db.update(salePeriods).set(input).where(eq(salePeriods.id, id)).returning();
      if (!row) return c.json(notFound, 404);
      return c.json(shape(row), 200);
    })
    .openapi(deletePeriodRoute, async (c) => {
      const { id } = c.req.valid("param");
      const [row] = await db.delete(salePeriods).where(eq(salePeriods.id, id)).returning();
      noteAudit(c, {
        action: "sale_period.delete",
        target: `sale_period:${id}`,
        ...(row ? { details: { name: row.name, startsOn: row.startsOn, endsOn: row.endsOn } } : {}),
      });
      if (!row) return c.json(notFound, 404);
      return c.body(null, 204);
    });
}
