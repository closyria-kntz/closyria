import { homeViewSchema } from "@closyria/shared";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { type AccessEnv, defineAccess } from "../../access";
import type { WardrobeDeps } from "../../wardrobe/deps";
import { homeView } from "../../wardrobe/home";

const homeRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/home",
    summary: "What « Accueil » shows",
    description:
      "Her first name, whether she keeps anything yet, the « une » (the newest news with a photo) and up to 4 other " +
      "news, newest first — price drops and sizes back on her wishes over the last 7 days, friends' opinions she has " +
      "not seen, her open or closed group orders, the gift reminders that are due — and up to 4 of her wishes " +
      "(priority ones first, then the newest). Facts only: the page words them.",
    responses: { 200: { description: "Her home", content: { "application/json": { schema: homeViewSchema } } } },
  }),
  "user",
);

export function homeRoutes(deps: WardrobeDeps) {
  const app = new OpenAPIHono<AccessEnv>();
  return app.openapi(homeRoute, async (c) => {
    const userId = c.var.session?.user.id;
    if (!userId) throw new Error("me route reached without a session");
    c.header("Cache-Control", "no-store");
    return c.json(await homeView(deps.db, userId, deps.now?.() ?? new Date()), 200);
  });
}
