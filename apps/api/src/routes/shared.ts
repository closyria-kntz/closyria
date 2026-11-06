import { eq, schema } from "@closyria/db";
import { sharedWishlistViewSchema, wardrobeErrorSchema } from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { type AccessEnv, defineAccess } from "../access";
import type { WardrobeDeps } from "../wardrobe/deps";
import { hashShareToken, SHARE_TOKEN_PATTERN } from "../wardrobe/share-token";
import { loadSharedView } from "../wardrobe/wishlists";

const sharedRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/shared/{token}",
    summary: "A shared list",
    description:
      "Public. Product data only (no notes, sizes, profiles or private photos). Never cached, never indexed. " +
      "A malformed, unknown or stopped token answers 404.",
    request: { params: z.object({ token: z.string() }) },
    responses: {
      200: { description: "The list", content: { "application/json": { schema: sharedWishlistViewSchema } } },
      404: {
        description: "Unknown or stopped share (not_found)",
        content: { "application/json": { schema: wardrobeErrorSchema } },
      },
    },
  }),
  "public",
);

/** A stopped share must not be served from a cache, and the page must stay out of search engines. */
function privateHeaders(c: Context<AccessEnv>) {
  c.header("X-Robots-Tag", "noindex");
  c.header("Cache-Control", "no-store");
}

export function sharedRoutes(deps: WardrobeDeps) {
  const { db } = deps;
  const app = new OpenAPIHono<AccessEnv>();
  return app.openapi(sharedRoute, async (c) => {
    privateHeaders(c);
    const { token } = c.req.valid("param");
    if (!SHARE_TOKEN_PATTERN.test(token)) return c.json({ error: "not_found" } as const, 404);
    const [list] = await db
      .select({ id: schema.wishlists.id, name: schema.wishlists.name })
      .from(schema.wishlists)
      .where(eq(schema.wishlists.shareTokenHash, hashShareToken(token)));
    if (!list) return c.json({ error: "not_found" } as const, 404);
    return c.json(await loadSharedView(db, list), 200);
  });
}
