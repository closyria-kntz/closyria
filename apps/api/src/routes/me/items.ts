import { and, eq, schema } from "@closyria/db";
import {
  itemCreateSchema,
  itemListQuerySchema,
  itemMoveSchema,
  itemMutationResultSchema,
  itemPageSchema,
  itemPatchSchema,
  itemStageInputSchema,
  itemViewSchema,
  wardrobeErrorSchema,
} from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import { type AccessEnv, defineAccess } from "../../access";
import { rateLimit } from "../../rate-limit";
import { trackItemEvent, WARDROBE_LIMITS, type WardrobeDeps } from "../../wardrobe/deps";
import { InvalidCursorError, listItems, loadItemView } from "../../wardrobe/item-view";
import {
  changeStage,
  createItem,
  type ItemOutcome,
  moveItem,
  patchItem,
  restoreItem,
  trashItem,
} from "../../wardrobe/items";

const invalidRequest = { error: "invalid_request" } as const;
const notFound = { error: "not_found" } as const;
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: wardrobeErrorSchema } },
});
const json = <S extends z.ZodType>(description: string, schema: S) => ({
  description,
  content: { "application/json": { schema } },
});
const body = <S extends z.ZodType>(schema: S) => ({
  body: { required: true, content: { "application/json": { schema } } },
});
const idParams = z.object({ id: z.uuid() });
const mutation = (description: string) => json(description, itemMutationResultSchema);
const notFoundContent = errorContent("Unknown or another account's item (not_found)");
const deletedContent = errorContent("The item is in the trash (item_deleted)");

const createItemRoute = (limiter: MiddlewareHandler<AccessEnv>) =>
  defineAccess(
    createRoute({
      method: "post",
      path: "/me/items",
      summary: "Keep a product",
      description:
        "`favorite` (♡: spotted, favorite), `list` (spotted, added to `wishlistId`) or `ordered` (ordered, with its " +
        "history row). Without `profileId`, goes to her first profile (« Moi » is created if needed). One item per " +
        "product (G2): when she already has an active one, it is returned as is with 200 and `undo: null`. " +
        "300 creations an hour per account.",
      middleware: [limiter],
      request: body(itemCreateSchema),
      responses: {
        201: mutation("Created; undo sends it to the trash"),
        200: mutation("She already keeps this product: her item, unchanged"),
        400: errorContent("Invalid body (invalid_request)"),
        404: errorContent("Unknown product, or another account's profile or list (not_found)"),
        429: errorContent("Over 300 creations this hour (rate_limited)"),
      },
    }),
    "user",
  );

const listRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/items",
    summary: "Her items",
    description:
      "48 per page, newest first by default; `nextCursor` gives the next page. `deleted=true`: the trash. " +
      "`category`/`color` match her correction, else the product's; `audience` and the price sorts use the product.",
    request: { query: itemListQuerySchema },
    responses: {
      200: json("A page", itemPageSchema),
      400: errorContent("Invalid query (invalid_request) or cursor (invalid_cursor)"),
      404: errorContent("`wishlist` is unknown or another account's list (not_found)"),
    },
  }),
  "user",
);

const getRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/items/{id}",
    summary: "One of her items",
    description: "Trashed items included.",
    request: { params: idParams },
    responses: {
      200: json("The item", itemViewSchema),
      400: errorContent("Malformed id (invalid_request)"),
      404: notFoundContent,
    },
  }),
  "user",
);

const patchRoute = defineAccess(
  createRoute({
    method: "patch",
    path: "/me/items/{id}",
    summary: "Change her own fields",
    description:
      "`coverMediaId` must be one of the item's photos; `categoryId`/`colorId` must exist. Only a favorite toggle " +
      "comes with an undo.",
    request: { params: idParams, ...body(itemPatchSchema) },
    responses: {
      200: mutation("Changed"),
      400: errorContent("Invalid body (invalid_request, invalid_cover, invalid_category, invalid_color)"),
      404: notFoundContent,
      409: deletedContent,
    },
  }),
  "user",
);

const stageRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/items/{id}/stage",
    summary: "Move the item to another stage",
    description:
      "Any other stage, forward or back, with its date; writes a history row. `amountCents` is the paid price " +
      "(`ordered`, `owned`) or the sale price (`for_sale`, `sold`); `channel` the sale channel.",
    request: { params: idParams, ...body(itemStageInputSchema) },
    responses: {
      200: mutation("Changed; undo restores the previous stage and deletes the history row"),
      400: errorContent("Invalid body (invalid_request) or already at that stage (same_stage)"),
      404: notFoundContent,
      409: deletedContent,
    },
  }),
  "user",
);

const moveRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/items/{id}/move",
    summary: "Move the item to another of her profiles",
    request: { params: idParams, ...body(itemMoveSchema) },
    responses: {
      200: mutation("Moved, traced in the history; undo moves it back"),
      400: errorContent("Invalid body (invalid_request) or already in that profile (same_profile)"),
      404: errorContent("Unknown or another account's item or profile (not_found)"),
      409: deletedContent,
    },
  }),
  "user",
);

const deleteRoute = defineAccess(
  createRoute({
    method: "delete",
    path: "/me/items/{id}",
    summary: "Send the item to the trash",
    description: "Kept 30 days in the trash.",
    request: { params: idParams },
    responses: {
      200: mutation("In the trash; undo restores it"),
      400: errorContent("Malformed id (invalid_request)"),
      404: notFoundContent,
      409: errorContent("Already in the trash (item_deleted)"),
    },
  }),
  "user",
);

const restoreRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/items/{id}/restore",
    summary: "Take the item out of the trash",
    description:
      "When she has kept the same product again meanwhile, both are merged into the active item (most advanced " +
      "stage; photos, lists, tags and history together), which is returned; a merge has no undo.",
    request: { params: idParams },
    responses: {
      200: mutation("Restored or merged"),
      400: errorContent("Malformed id (invalid_request)"),
      404: notFoundContent,
      409: errorContent("Not in the trash (item_not_deleted)"),
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

export function itemsRoutes(deps: WardrobeDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });
  const creations = deps.limits?.itemCreations ?? WARDROBE_LIMITS.itemCreations;
  const limiter = rateLimit<AccessEnv>({ ...creations, key: (c) => `user:${c.var.session?.user.id ?? ""}` }, (c) =>
    c.json({ error: "rate_limited" } as const, 429),
  );

  /** The mutation answer: ids, undo and the item as it now is; null when it is gone meanwhile (404). */
  async function answer(userId: string, outcome: Exclude<ItemOutcome, { error: unknown }>) {
    const item = await loadItemView(db, userId, outcome.itemId);
    return item ? { itemIds: outcome.itemIds, undo: outcome.undo, item } : null;
  }

  /** 200 with the answer, or 404 when the item is gone. */
  const respond = <C extends Context<AccessEnv>>(c: C, result: Awaited<ReturnType<typeof answer>>) =>
    result ? c.json(result, 200) : c.json(notFound, 404);

  return app
    .openapi(createItemRoute(limiter), async (c) => {
      const userId = userIdOf(c);
      const input = c.req.valid("json");
      const outcome = await createItem(db, userId, input, now());
      if ("error" in outcome) return c.json(notFound, 404);
      const result = await answer(userId, outcome);
      if (!result) return c.json(notFound, 404);
      if (!outcome.created) return c.json(result, 200);
      await trackItemEvent(db, userId, "item_saved", { action: input.action, stage: result.item.stage });
      return c.json(result, 201);
    })
    .openapi(listRoute, async (c) => {
      try {
        const query = c.req.valid("query");
        if (query.wishlist) {
          const [own] = await db
            .select({ id: schema.wishlists.id })
            .from(schema.wishlists)
            .where(and(eq(schema.wishlists.id, query.wishlist), eq(schema.wishlists.userId, userIdOf(c))));
          if (!own) return c.json(notFound, 404);
        }
        return c.json(await listItems(db, userIdOf(c), query), 200);
      } catch (error) {
        if (error instanceof InvalidCursorError) return c.json({ error: "invalid_cursor" } as const, 400);
        throw error;
      }
    })
    .openapi(getRoute, async (c) => {
      const item = await loadItemView(db, userIdOf(c), c.req.valid("param").id);
      return item ? c.json(item, 200) : c.json(notFound, 404);
    })
    .openapi(patchRoute, async (c) => {
      const userId = userIdOf(c);
      const outcome = await patchItem(db, userId, c.req.valid("param").id, c.req.valid("json"), now());
      if ("error" in outcome) {
        switch (outcome.error) {
          case "not_found":
            return c.json(notFound, 404);
          case "item_deleted":
            return c.json({ error: outcome.error }, 409);
          case "invalid_cover":
          case "invalid_category":
          case "invalid_color":
            return c.json({ error: outcome.error }, 400);
          default:
            throw new Error(`unexpected outcome ${outcome.error}`);
        }
      }
      return respond(c, await answer(userId, outcome));
    })
    .openapi(stageRoute, async (c) => {
      const userId = userIdOf(c);
      const input = c.req.valid("json");
      const outcome = await changeStage(db, userId, c.req.valid("param").id, input, now());
      if ("error" in outcome) {
        if (outcome.error === "not_found") return c.json(notFound, 404);
        if (outcome.error === "item_deleted") return c.json({ error: outcome.error }, 409);
        return c.json({ error: "same_stage" } as const, 400);
      }
      await trackItemEvent(db, userId, "item_stage_changed", {
        from: outcome.previous?.stage ?? "",
        to: input.stage,
      });
      return respond(c, await answer(userId, outcome));
    })
    .openapi(moveRoute, async (c) => {
      const userId = userIdOf(c);
      const outcome = await moveItem(db, userId, c.req.valid("param").id, c.req.valid("json"), now());
      if ("error" in outcome) {
        if (outcome.error === "not_found") return c.json(notFound, 404);
        if (outcome.error === "item_deleted") return c.json({ error: outcome.error }, 409);
        return c.json({ error: "same_profile" } as const, 400);
      }
      await trackItemEvent(db, userId, "item_moved", {});
      return respond(c, await answer(userId, outcome));
    })
    .openapi(deleteRoute, async (c) => {
      const userId = userIdOf(c);
      const outcome = await trashItem(db, userId, c.req.valid("param").id, now());
      if ("error" in outcome) {
        return outcome.error === "not_found" ? c.json(notFound, 404) : c.json({ error: "item_deleted" } as const, 409);
      }
      return respond(c, await answer(userId, outcome));
    })
    .openapi(restoreRoute, async (c) => {
      const userId = userIdOf(c);
      const outcome = await restoreItem(db, userId, c.req.valid("param").id, now());
      if ("error" in outcome) {
        return outcome.error === "not_found"
          ? c.json(notFound, 404)
          : c.json({ error: "item_not_deleted" } as const, 409);
      }
      return respond(c, await answer(userId, outcome));
    });
}
