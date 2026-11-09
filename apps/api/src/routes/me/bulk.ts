import { itemBulkActionSchema, mutationResultSchema, undoPayloadSchema, wardrobeErrorSchema } from "@closyria/shared";
import { createRoute, OpenAPIHono, type z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { type AccessEnv, defineAccess } from "../../access";
import { type BulkOutcome, runBulk, runUndo } from "../../wardrobe/bulk";
import { trackItemEvents, type WardrobeDeps } from "../../wardrobe/deps";

const invalidRequest = { error: "invalid_request" } as const;
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: wardrobeErrorSchema } },
});
const body = <S extends z.ZodType>(schema: S) => ({
  body: { required: true, content: { "application/json": { schema } } },
});
const mutation = (description: string) => ({
  description,
  content: { "application/json": { schema: mutationResultSchema } },
});
const errors = {
  400: errorContent("Invalid body (invalid_request), or for setFields: invalid_cover, invalid_category, invalid_color"),
  404: errorContent("An item, profile, list, tag or history row of another account or unknown (not_found)"),
  409: errorContent("An item in the trash, for any op but delete and restore (item_deleted)"),
};

const bulkRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/items/bulk",
    summary: "One action on up to 200 of her items",
    description:
      "One transaction, all or nothing. `delete` sends to the trash; `restore` merges with an active item kept " +
      "for the same product meanwhile. `stage` and `move` write one history row per item changed. Items already " +
      "in the requested state are left as they are; `itemIds` lists the ones changed. `undo`: the inverse ops, " +
      "grouped by previous value, and the history rows to delete — to send back to `/me/items/undo`.",
    request: body(itemBulkActionSchema),
    responses: { 200: mutation("Done"), ...errors },
  }),
  "user",
);

const undoRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/items/undo",
    summary: "Undo an action",
    description:
      "Replays the `undo` an action returned: its ops in order, through the same code as `/me/items/bulk` but " +
      "without writing history, then deletes the history rows listed. One transaction, all or nothing. An undo " +
      "cannot be undone (`undo: null`).",
    request: body(undoPayloadSchema),
    responses: { 200: mutation("Undone"), ...errors },
  }),
  "user",
);

/** `user` access ran first: the session is there. */
function userIdOf(c: Context<AccessEnv>): string {
  const id = c.var.session?.user.id;
  if (!id) throw new Error("me route reached without a session");
  return id;
}

export function bulkRoutes(deps: WardrobeDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });

  const respond = <C extends Context<AccessEnv>>(c: C, outcome: BulkOutcome) => {
    if (!("error" in outcome)) return c.json({ itemIds: outcome.itemIds, undo: outcome.undo }, 200);
    switch (outcome.error) {
      case "not_found":
        return c.json({ error: outcome.error }, 404);
      case "item_deleted":
        return c.json({ error: outcome.error }, 409);
      case "invalid_cover":
      case "invalid_category":
      case "invalid_color":
        return c.json({ error: outcome.error }, 400);
      default:
        throw new Error(`unexpected outcome ${outcome.error}`);
    }
  };

  return app
    .openapi(bulkRoute, async (c) => {
      const userId = userIdOf(c);
      const at = now();
      const outcome = await runBulk(db, userId, c.req.valid("json"), at);
      if (!("error" in outcome)) {
        // Audience events (spec §6): one row per item, as on the single-item routes, in one insert.
        await trackItemEvents(
          db,
          userId,
          [
            ...outcome.trace.stageChanges.map((change) => ({
              name: "item_stage_changed" as const,
              props: { from: change.from, to: change.to },
            })),
            ...Array.from({ length: outcome.trace.moves }, () => ({ name: "item_moved" as const, props: {} })),
          ],
          at,
        );
      }
      return respond(c, outcome);
    })
    .openapi(undoRoute, async (c) => respond(c, await runUndo(db, userIdOf(c), c.req.valid("json"), now())));
}
