import { shopDirectorySchema } from "@closyria/shared";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { type AccessEnv, defineAccess } from "../access";
import type { CatalogDeps } from "../catalog/deps";
import { loadShopDirectory } from "../catalog/directory";

const directoryRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/shops",
    summary: "The shops of « Découvrir »",
    description:
      "Published shops that are not merged, each with its main domain, how many products Closyria knows of it and one " +
      "recent photo; the « boutique de la semaine » (the one an admin featured most recently) apart. The most " +
      "products first, then by name. Never anything about who pasted the products.",
    responses: {
      200: { description: "The shops", content: { "application/json": { schema: shopDirectorySchema } } },
    },
  }),
  "user",
);

export function shopsRoutes(deps: CatalogDeps) {
  const app = new OpenAPIHono<AccessEnv>();
  return app.openapi(directoryRoute, async (c) => {
    c.header("Cache-Control", "private, no-cache");
    // Shop product photos are shown to admins only until the shops agree to be listed.
    const session = c.var.session;
    const admin = session?.user.role === "admin" && session.session.authMethod === "passkey";
    return c.json(await loadShopDirectory(deps.db, admin), 200);
  });
}
