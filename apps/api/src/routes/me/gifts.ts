import {
  giftCheckQuerySchema,
  giftCheckSchema,
  giftTookSchema,
  itemMutationResultSchema,
  wardrobeErrorSchema,
} from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { type AccessEnv, defineAccess } from "../../access";
import { trackItemEvent, type WardrobeDeps } from "../../wardrobe/deps";
import { markOwnerTook, reservedItemIds } from "../../wardrobe/gifts";
import { loadItemView } from "../../wardrobe/item-view";
import { receiveAsGift } from "../../wardrobe/received-gift";

// Her side of the gifts. Leak rule (spec § 6): nothing here returns a gift row or a giver's name; the names reach
// her only frozen in `items.gift_from`, after « Reçu en cadeau ».

const invalidRequest = { error: "invalid_request" } as const;
const notFound = { error: "not_found" } as const;
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: wardrobeErrorSchema } },
});

const giftCheckRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/items/gift-check",
    summary: "Which of these items a friend plans to give",
    description:
      "Asked just before « Je le prends », « J'ai commandé » or a move to « Commandé » / « Reçu »: the ids (of the " +
      "ones asked, up to 200) with a friend's gift on one of her lists shared and open to gifts, not taken by " +
      "herself. Ids only, never who.",
    request: { query: giftCheckQuerySchema },
    responses: {
      200: { description: "The reserved ids", content: { "application/json": { schema: giftCheckSchema } } },
      400: errorContent("Malformed ids (invalid_request)"),
    },
  }),
  "user",
);

const giftTookRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/items/gift-took",
    summary: "She takes these items herself",
    description:
      "« Je le prends quand même »: her friends' gifts of the items show « pris elle-même » on the link. Items not " +
      "hers or without a gift are left as they are.",
    request: { body: { required: true, content: { "application/json": { schema: giftTookSchema } } } },
    responses: { 204: { description: "Marked" }, 400: errorContent("Invalid body (invalid_request)") },
  }),
  "user",
);

const receivedRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/items/{id}/received-as-gift",
    summary: "« Reçu en cadeau »",
    description:
      "The item goes to « Reçu » (a history row) with `giftFrom` = the givers' first names, frozen (null when " +
      "nobody had planned it: « Offert par une amie »); her friends' gifts of it are over on every list. `undo`, " +
      "for `/me/items/undo`: the previous stage, and `unreceiveGift` (gifts back, `giftFrom` cleared).",
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: { description: "Received", content: { "application/json": { schema: itemMutationResultSchema } } },
      400: errorContent("Malformed id (invalid_request) or a gift already (same_stage)"),
      404: errorContent("Unknown or another account's item (not_found)"),
      409: errorContent("In the trash (item_deleted)"),
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

/** Mounted before the item routes: `/me/items/gift-check` is not an item id. */
export function giftsRoutes(deps: WardrobeDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });

  return app
    .openapi(giftCheckRoute, async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json({ reserved: await reservedItemIds(db, userIdOf(c), c.req.valid("query").ids) }, 200);
    })
    .openapi(giftTookRoute, async (c) => {
      await markOwnerTook(db, userIdOf(c), c.req.valid("json").ids);
      return c.body(null, 204);
    })
    .openapi(receivedRoute, async (c) => {
      const userId = userIdOf(c);
      const outcome = await receiveAsGift(db, userId, c.req.valid("param").id, now());
      if ("error" in outcome) {
        if (outcome.error === "not_found") return c.json(notFound, 404);
        if (outcome.error === "item_deleted") return c.json({ error: outcome.error }, 409);
        return c.json({ error: "same_stage" } as const, 400);
      }
      if (outcome.previous && outcome.previous.stage !== "owned")
        await trackItemEvent(db, userId, "item_stage_changed", { from: outcome.previous.stage, to: "owned" });
      const item = await loadItemView(db, userId, outcome.itemId);
      return item ? c.json({ itemIds: outcome.itemIds, undo: outcome.undo, item }, 200) : c.json(notFound, 404);
    });
}
