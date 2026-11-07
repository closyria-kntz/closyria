import { eq, schema } from "@closyria/db";
import { type LoveLevelView, loveLevelsSchema, wardrobeErrorSchema } from "@closyria/shared";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { type AccessEnv, defineAccess } from "../../access";
import type { WardrobeDeps } from "../../wardrobe/deps";
import { readLoveLevels } from "../../wardrobe/love-levels";

const invalidRequest = { error: "invalid_request" } as const;
const levelsResponse = {
  description: "Her four levels",
  content: { "application/json": { schema: loveLevelsSchema } },
};

const getRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/love-levels",
    summary: "Her names and emojis for the 4 levels",
    description: "The starting ones (Bof, J’aime, Mims, En feu) while she has not changed them.",
    responses: { 200: levelsResponse },
  }),
  "user",
);

const putRoute = defineAccess(
  createRoute({
    method: "put",
    path: "/me/love-levels",
    summary: "Rename the 4 levels",
    description: "Replaces all four at once: levels 1 to 4 once each, one emoji, a label of 1 to 20 characters.",
    request: { body: { required: true, content: { "application/json": { schema: loveLevelsSchema } } } },
    responses: {
      200: levelsResponse,
      400: {
        description: "Invalid body (invalid_request)",
        content: { "application/json": { schema: wardrobeErrorSchema } },
      },
    },
  }),
  "user",
);

const deleteRoute = defineAccess(
  createRoute({
    method: "delete",
    path: "/me/love-levels",
    summary: "Back to the starting levels",
    responses: { 204: { description: "Reset" } },
  }),
  "user",
);

/** `user` access ran first: the session is there. */
function userIdOf(c: Context<AccessEnv>): string {
  const id = c.var.session?.user.id;
  if (!id) throw new Error("me route reached without a session");
  return id;
}

export function loveLevelsRoutes(deps: WardrobeDeps) {
  const { db } = deps;
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });

  async function read(userId: string): Promise<{ levels: LoveLevelView[] }> {
    return { levels: await readLoveLevels(db, userId) };
  }

  return app
    .openapi(getRoute, async (c) => c.json(await read(userIdOf(c)), 200))
    .openapi(putRoute, async (c) => {
      const userId = userIdOf(c);
      const { levels } = c.req.valid("json");
      await db.transaction(async (tx) => {
        await tx.delete(schema.loveLevels).where(eq(schema.loveLevels.userId, userId));
        await tx.insert(schema.loveLevels).values(levels.map((l) => ({ userId, ...l })));
      });
      return c.json(await read(userId), 200);
    })
    .openapi(deleteRoute, async (c) => {
      await db.delete(schema.loveLevels).where(eq(schema.loveLevels.userId, userIdOf(c)));
      return c.body(null, 204);
    });
}
