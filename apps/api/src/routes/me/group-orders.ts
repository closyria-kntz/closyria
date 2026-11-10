import {
  groupOrderActionSchema,
  groupOrderCreateSchema,
  groupOrderOrderSchema,
  groupOrderOwnLinesSchema,
  groupOrderPastListSchema,
  groupOrderPatchSchema,
  groupOrderPaymentInputSchema,
  type OwnerGroupOrder,
  ownerGroupOrderSchema,
  type WardrobeErrorCode,
  wardrobeErrorSchema,
} from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { type AccessEnv, defineAccess } from "../../access";
import type { WardrobeDeps } from "../../wardrobe/deps";
import {
  actOnGroupOrder,
  currentGroupOrder,
  openGroupOrder,
  orderGroupOrder,
  pastGroupOrders,
  patchGroupOrder,
  replaceOwnLines,
  setLineRemoved,
  setPaid,
} from "../../wardrobe/group-orders";

// Her side of « Acheter ensemble » (spec § 4). Everything goes through her list: another account gets 404.

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
const listParams = z.object({ id: z.uuid() });
const orderParams = z.object({ id: z.uuid() });
const lineParams = z.object({ id: z.uuid(), lineId: z.uuid() });
const paymentParams = z.object({ id: z.uuid(), nameKey: z.string().min(1).max(200) });
const view = (description: string) => json(description, ownerGroupOrderSchema);
const notFoundContent = errorContent("Unknown or another account's list, group order or line (not_found)");
const lockedContent = errorContent("Ordered or cancelled: nothing changes any more (group_order_locked)");

const openRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/wishlists/{id}/group-order",
    summary: "Open a group order",
    description:
      "For one shop of the list's items. The delivery is a shop's option (copied: a later change in the admin " +
      "leaves the order as it is) or typed in; the deadline is today or later.",
    request: { params: listParams, ...body(groupOrderCreateSchema) },
    responses: {
      201: view("Opened"),
      400: errorContent("Invalid body or option (invalid_request), shop with no item on the list (shop_not_in_list)"),
      404: notFoundContent,
      409: errorContent("List not shared (not_shared), a group order already open or closed (already_open)"),
    },
  }),
  "user",
);

const currentRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/wishlists/{id}/group-order",
    summary: "Her group order on this list",
    description: "The open or closed one, else the latest ordered or cancelled in the last 30 days.",
    request: { params: listParams },
    responses: { 200: view("The group order"), 404: notFoundContent },
  }),
  "user",
);

const pastRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/wishlists/{id}/group-orders",
    summary: "« Commandes groupées passées »",
    description: "Ordered or cancelled, most recent first, with the friends not marked « Payé ».",
    request: { params: listParams },
    responses: { 200: json("The past ones", groupOrderPastListSchema), 404: notFoundContent },
  }),
  "user",
);

const patchRoute = defineAccess(
  createRoute({
    method: "patch",
    path: "/me/group-orders/{id}",
    summary: "Change the deadline or the delivery",
    request: { params: orderParams, ...body(groupOrderPatchSchema) },
    responses: {
      200: view("Changed"),
      400: errorContent("Invalid body or a past deadline (invalid_request)"),
      404: notFoundContent,
      409: lockedContent,
    },
  }),
  "user",
);

const actionRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/group-orders/{id}/action",
    summary: "« Clôturer », « Rouvrir », « Annuler la commande groupée »",
    description: "close: open → closed; reopen: closed → open; cancel: open or closed → cancelled.",
    request: { params: orderParams, ...body(groupOrderActionSchema) },
    responses: {
      200: view("Done"),
      400: errorContent("Invalid body (invalid_request)"),
      404: notFoundContent,
      409: errorContent("Not from this state (invalid_transition)"),
    },
  }),
  "user",
);

const ownLinesRoute = defineAccess(
  createRoute({
    method: "put",
    path: "/me/group-orders/{id}/own-lines",
    summary: "« Je le prends dans cette commande »",
    description: "Replaces all her lines: items of the list and of the order's shop only.",
    request: { params: orderParams, ...body(groupOrderOwnLinesSchema) },
    responses: {
      200: view("Her lines"),
      400: errorContent("Invalid body, or an item not on the list or of another shop (invalid_request)"),
      404: notFoundContent,
      409: errorContent("Ordered or cancelled (group_order_locked), another currency (currency_mismatch)"),
    },
  }),
  "user",
);

const removeLineRoute = defineAccess(
  createRoute({
    method: "delete",
    path: "/me/group-orders/{id}/lines/{lineId}",
    summary: "« Retirer » a line",
    description: "The line stays, marked removed (the friend is told); `restore` puts it back.",
    request: { params: lineParams },
    responses: {
      200: view("Removed"),
      400: errorContent("Malformed id (invalid_request)"),
      404: notFoundContent,
      409: lockedContent,
    },
  }),
  "user",
);

const restoreLineRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/group-orders/{id}/lines/{lineId}/restore",
    summary: "Undo « Retirer »",
    request: { params: lineParams },
    responses: {
      200: view("Back"),
      400: errorContent("Malformed id (invalid_request)"),
      404: notFoundContent,
      409: lockedContent,
    },
  }),
  "user",
);

const orderRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/group-orders/{id}/order",
    summary: "« J'ai commandé »",
    description:
      "From open or closed: freezes each active line's price (the one given, else its current price) and the real " +
      "shipping, writes what each friend owes, and moves her items of the order to « Commandé ». No undo.",
    request: { params: orderParams, ...body(groupOrderOrderSchema) },
    responses: {
      200: view("Ordered"),
      400: errorContent(
        "Invalid body or a line of another order (invalid_request), a line with no price (missing_price)",
      ),
      404: notFoundContent,
      409: errorContent("Ordered or cancelled already (invalid_transition)"),
    },
  }),
  "user",
);

const paymentRoute = defineAccess(
  createRoute({
    method: "put",
    path: "/me/group-orders/{id}/payments/{nameKey}",
    summary: "« Payé » for one friend",
    description: "`nameKey`: the friend's key (`people[].key`). Ticked or unticked.",
    request: { params: paymentParams, ...body(groupOrderPaymentInputSchema) },
    responses: {
      200: view("Changed"),
      400: errorContent("Invalid body (invalid_request)"),
      404: errorContent("Unknown order or nobody owes under this key (not_found)"),
      409: errorContent("Not ordered (invalid_transition)"),
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

const STATUS_OF: Partial<Record<WardrobeErrorCode, 400 | 404 | 409>> = {
  invalid_request: 400,
  shop_not_in_list: 400,
  missing_price: 400,
  not_found: 404,
  not_shared: 409,
  already_open: 409,
  group_order_locked: 409,
  invalid_transition: 409,
  currency_mismatch: 409,
};

export function groupOrdersRoutes(deps: WardrobeDeps) {
  const { db } = deps;
  const now = () => deps.now?.() ?? new Date();
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });
  // Every answer is her whole group order, or an error code.
  const respond = (c: Context<AccessEnv>, outcome: OwnerGroupOrder | { error: WardrobeErrorCode }) => {
    if ("error" in outcome) {
      const status = STATUS_OF[outcome.error];
      if (!status) throw new Error(`unexpected group order error ${outcome.error}`);
      return c.json({ error: outcome.error }, status);
    }
    return c.json(outcome, 200);
  };

  return app
    .openapi(openRoute, async (c) => {
      const outcome = await openGroupOrder(db, userIdOf(c), c.req.valid("param").id, c.req.valid("json"), now());
      if ("error" in outcome) {
        const { error } = outcome;
        if (error === "not_found") return c.json(notFound, 404);
        if (error === "not_shared" || error === "already_open") return c.json({ error }, 409);
        return c.json({ error: error === "shop_not_in_list" ? error : "invalid_request" } as const, 400);
      }
      return c.json(outcome, 201);
    })
    .openapi(currentRoute, async (c) => {
      c.header("Cache-Control", "no-store");
      const order = await currentGroupOrder(db, userIdOf(c), c.req.valid("param").id, now());
      return order ? c.json(order, 200) : c.json(notFound, 404);
    })
    .openapi(pastRoute, async (c) => {
      c.header("Cache-Control", "no-store");
      const past = await pastGroupOrders(db, userIdOf(c), c.req.valid("param").id);
      return past ? c.json(past, 200) : c.json(notFound, 404);
    })
    .openapi(patchRoute, async (c) =>
      respond(c, await patchGroupOrder(db, userIdOf(c), c.req.valid("param").id, c.req.valid("json"), now())),
    )
    .openapi(actionRoute, async (c) =>
      respond(c, await actOnGroupOrder(db, userIdOf(c), c.req.valid("param").id, c.req.valid("json").action, now())),
    )
    .openapi(ownLinesRoute, async (c) =>
      respond(c, await replaceOwnLines(db, userIdOf(c), c.req.valid("param").id, c.req.valid("json"), now())),
    )
    .openapi(removeLineRoute, async (c) => {
      const { id, lineId } = c.req.valid("param");
      return respond(c, await setLineRemoved(db, userIdOf(c), id, lineId, true, now()));
    })
    .openapi(restoreLineRoute, async (c) => {
      const { id, lineId } = c.req.valid("param");
      return respond(c, await setLineRemoved(db, userIdOf(c), id, lineId, false, now()));
    })
    .openapi(orderRoute, async (c) =>
      respond(c, await orderGroupOrder(db, userIdOf(c), c.req.valid("param").id, c.req.valid("json"), now())),
    )
    .openapi(paymentRoute, async (c) => {
      const { id, nameKey } = c.req.valid("param");
      return respond(c, await setPaid(db, userIdOf(c), id, nameKey, c.req.valid("json").paid, now()));
    });
}
