import { and, eq, isNull, schema } from "@closyria/db";
import { facetsViewSchema } from "@closyria/shared";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { type AccessEnv, defineAccess } from "../../access";
import type { WardrobeDeps } from "../../wardrobe/deps";

const facetsRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/facets",
    summary: "What her filters offer",
    description: "The distinct shops of her items that are not in the trash, by name (French order).",
    responses: { 200: { description: "Facets", content: { "application/json": { schema: facetsViewSchema } } } },
  }),
  "user",
);

const byName = new Intl.Collator("fr", { sensitivity: "base" });

export function facetsRoutes(deps: WardrobeDeps) {
  const { db } = deps;
  const app = new OpenAPIHono<AccessEnv>();
  return app.openapi(facetsRoute, async (c) => {
    const userId = c.var.session?.user.id;
    if (!userId) throw new Error("me route reached without a session");
    const shops = await db
      .selectDistinct({ id: schema.shops.id, name: schema.shops.name })
      .from(schema.items)
      .innerJoin(schema.products, eq(schema.products.id, schema.items.productId))
      .innerJoin(schema.shops, eq(schema.shops.id, schema.products.shopId))
      .where(and(eq(schema.items.userId, userId), isNull(schema.items.deletedAt)));
    shops.sort((a, b) => byName.compare(a.name, b.name) || a.id.localeCompare(b.id));
    return c.json({ shops }, 200);
  });
}
