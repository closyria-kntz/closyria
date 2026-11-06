import { asc, schema } from "@closyria/db";
import { referenceViewSchema } from "@closyria/shared";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { type AccessEnv, defineAccess } from "../access";
import type { WardrobeDeps } from "../wardrobe/deps";

const referenceRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/reference",
    summary: "Categories and colours",
    description: "Public, the same for everyone; cached for an hour. The filters and the item fields read it.",
    responses: {
      200: { description: "Reference lists", content: { "application/json": { schema: referenceViewSchema } } },
    },
  }),
  "public",
);

export function referenceRoutes(deps: WardrobeDeps) {
  const { db } = deps;
  const app = new OpenAPIHono<AccessEnv>();
  return app.openapi(referenceRoute, async (c) => {
    const [categories, colors] = await Promise.all([
      db
        .select({
          id: schema.categories.id,
          parentId: schema.categories.parentId,
          name: schema.categories.name,
          position: schema.categories.position,
        })
        .from(schema.categories)
        .orderBy(asc(schema.categories.position), asc(schema.categories.name), asc(schema.categories.id)),
      db
        .select({ id: schema.colors.id, name: schema.colors.name, hex: schema.colors.hex })
        .from(schema.colors)
        .orderBy(asc(schema.colors.name), asc(schema.colors.id)),
    ]);
    c.header("Cache-Control", "public, max-age=3600");
    return c.json({ categories, colors }, 200);
  });
}
