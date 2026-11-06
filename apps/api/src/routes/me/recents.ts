import { and, desc, eq, schema, sql } from "@closyria/db";
import { RECENT_PRODUCTS_LIMIT, recentListSchema, wardrobeErrorSchema } from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { type AccessEnv, defineAccess } from "../../access";
import { loadProductViews } from "../../catalog/product-view";
import type { WardrobeDeps } from "../../wardrobe/deps";

const invalidRequest = { error: "invalid_request" } as const;

const listRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/recents",
    summary: "The links she pasted lately",
    description:
      `The ${RECENT_PRODUCTS_LIMIT} most recent, latest first, without the pages she already keeps ` +
      "(an item not in the trash on that product, in any profile).",
    responses: {
      200: {
        description: "Her recent links",
        content: { "application/json": { schema: recentListSchema } },
      },
    },
  }),
  "user",
);

const forgetRoute = defineAccess(
  createRoute({
    method: "delete",
    path: "/me/recents/{productId}",
    summary: "Forget a recent link",
    description: "Also answers 204 when the product is not in her recent links.",
    request: { params: z.object({ productId: z.uuid() }) },
    responses: {
      204: { description: "Forgotten" },
      400: {
        description: "Malformed id (invalid_request)",
        content: { "application/json": { schema: wardrobeErrorSchema } },
      },
    },
  }),
  "user",
);

/** `user` access ran first: the session is there. */
function userIdOf(c: Context<AccessEnv>): string {
  const id = c.var.session?.user.id;
  if (!id) throw new Error("me route reached without a session");
  return id;
}

export function recentsRoutes(deps: WardrobeDeps) {
  const { db } = deps;
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });

  return app
    .openapi(listRoute, async (c) => {
      const userId = userIdOf(c);
      const rows = await db
        .select({ productId: schema.recentProducts.productId, visitedAt: schema.recentProducts.visitedAt })
        .from(schema.recentProducts)
        .where(
          and(
            eq(schema.recentProducts.userId, userId),
            sql`not exists (
              select 1 from ${schema.items}
              where ${schema.items.userId} = ${userId}
                and ${schema.items.productId} = ${schema.recentProducts.productId}
                and ${schema.items.deletedAt} is null)`,
          ),
        )
        .orderBy(desc(schema.recentProducts.visitedAt), desc(schema.recentProducts.productId))
        .limit(RECENT_PRODUCTS_LIMIT);
      const views = await loadProductViews(
        db,
        rows.map((r) => r.productId),
      );
      const recents = rows.flatMap((r) => {
        const product = views.get(r.productId);
        return product ? [{ product, visitedAt: r.visitedAt.toISOString() }] : [];
      });
      return c.json(recentListSchema.parse({ recents }), 200);
    })
    .openapi(forgetRoute, async (c) => {
      const userId = userIdOf(c);
      const { productId } = c.req.valid("param");
      await db
        .delete(schema.recentProducts)
        .where(and(eq(schema.recentProducts.userId, userId), eq(schema.recentProducts.productId, productId)));
      return c.body(null, 204);
    });
}
