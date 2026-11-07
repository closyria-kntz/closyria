import { mutationResultSchema, orderDraftInputSchema, wardrobeErrorSchema } from "@closyria/shared";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { type AccessEnv, defineAccess } from "../../access";
import { runOrderDraft } from "../../wardrobe/bulk";
import { trackItemEvents, type WardrobeDeps } from "../../wardrobe/deps";

const invalidRequest = { error: "invalid_request" } as const;
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: wardrobeErrorSchema } },
});

const orderedRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/order-draft/ordered",
    summary: "« J'ai commandé »: her order selection goes to « Commandé »",
    description:
      "The selected wishes (`inOrderDraft`) still « Repéré » and not in the trash — of the profile (`profileId`) or " +
      "in the list (`wishlistId`) — go to « Commandé » today and leave the selection, in one transaction. One " +
      "history row per item, with the amount counted in the budgets. `undo`: back to « Repéré », selected again, " +
      "history rows deleted — to send back to `/me/items/undo`. At most 200 items in one go.",
    request: { body: { required: true, content: { "application/json": { schema: orderDraftInputSchema } } } },
    responses: {
      200: { description: "Ordered", content: { "application/json": { schema: mutationResultSchema } } },
      400: errorContent("Invalid body (invalid_request)"),
      404: errorContent("A profile or list of another account or unknown (not_found)"),
      409: errorContent("Nothing selected (order_draft_empty), or more than 200 items (order_draft_too_large)"),
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

export function orderDraftRoutes(deps: WardrobeDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });

  return app.openapi(orderedRoute, async (c) => {
    const userId = userIdOf(c);
    const at = now();
    const outcome = await runOrderDraft(db, userId, c.req.valid("json"), at);
    if ("error" in outcome) {
      switch (outcome.error) {
        case "not_found":
          return c.json({ error: outcome.error }, 404);
        case "order_draft_empty":
        case "order_draft_too_large":
          return c.json({ error: outcome.error }, 409);
        default:
          throw new Error(`unexpected outcome ${outcome.error}`);
      }
    }
    // Audience events (spec §6): one stage change per item, as the batches.
    await trackItemEvents(
      db,
      userId,
      outcome.trace.stageChanges.map((change) => ({
        name: "item_stage_changed" as const,
        props: { from: change.from, to: change.to },
      })),
      at,
    );
    return c.json({ itemIds: outcome.itemIds, undo: outcome.undo }, 200);
  });
}
