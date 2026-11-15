import {
  manualOrderInputSchema,
  orderListSchema,
  orderPatchSchema,
  orderViewSchema,
  trackingInputSchema,
  wardrobeErrorSchema,
} from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import { type AccessEnv, defineAccess } from "../../access";
import { listOrderViews } from "../../orders/view";
import {
  addItemTracking,
  confirmOrder,
  createManualOrder,
  dismissOrder,
  type OrderOutcome,
  patchOrder,
} from "../../orders/write";
import { rateLimit } from "../../rate-limit";
import { WARDROBE_LIMITS, type WardrobeDeps } from "../../wardrobe/deps";
import { accountOf } from "./order-inbox";

const invalidRequest = { error: "invalid_request" } as const;
const accountRequired = { error: "account_required" } as const;
const notFound = { error: "not_found" } as const;
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: wardrobeErrorSchema } },
});
const orderContent = (description: string) => ({
  description,
  content: { "application/json": { schema: orderViewSchema } },
});
const body = <S extends z.ZodType>(schema: S) => ({
  body: { required: true, content: { "application/json": { schema } } },
});
const idParams = z.object({ id: z.uuid() });
const common = {
  400: errorContent("Invalid body or id (invalid_request)"),
  403: errorContent("A guest: create an account first (account_required)"),
  404: errorContent("Unknown or another account's order, profile or e-mail (not_found)"),
};

const listRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/orders",
    summary: "« Mes commandes »: her orders to validate and her orders",
    description: `Drafts read from her e-mails and validated orders, newest first (100 at most); dismissed ones are not listed. Accounts only.`,
    responses: {
      200: { description: "Her orders", content: { "application/json": { schema: orderListSchema } } },
      403: common[403],
    },
  }),
  "user",
);

const patchRoute = defineAccess(
  createRoute({
    method: "patch",
    path: "/me/orders/{id}",
    summary: "« Corriger » an order to validate",
    description:
      "Only the fields given change; `lines` replaces them all. `shopName` finds the shop of exactly that name (case " +
      "and accents aside); otherwise the order keeps no shop and her name for it — a typed name never creates a shop.",
    request: { params: idParams, ...body(orderPatchSchema) },
    responses: {
      200: orderContent("Corrected"),
      ...common,
      409: errorContent("Already validated or dismissed (order_not_draft)"),
    },
  }),
  "user",
);

const confirmRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/orders/{id}/confirm",
    summary: "« C'est bon »: validate the order",
    description:
      "Each line gets its article: her item for the line's product, else her one wish or ordered article of the same " +
      "shop and name (case, accents and punctuation aside; never on a doubt), which goes to « Commandé » with the " +
      "order's size and price; else a new article « Commandé » (without a product when the line has none). " +
      "Idempotent: a validated order is answered as it is.",
    request: { params: idParams },
    responses: {
      200: orderContent("Validated"),
      ...common,
      409: errorContent("Dismissed (order_dismissed)"),
    },
  }),
  "user",
);

const dismissRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/orders/{id}/dismiss",
    summary: "« Ce n'est pas une commande »",
    description: "The draft is set aside (no longer listed); twice is harmless.",
    request: { params: idParams },
    responses: {
      200: orderContent("Dismissed"),
      ...common,
      409: errorContent("Already validated (order_not_draft)"),
    },
  }),
  "user",
);

const manualRoute = (limiter: MiddlewareHandler<AccessEnv>) =>
  defineAccess(
    createRoute({
      method: "post",
      path: "/me/orders",
      middleware: [limiter],
      summary: "Type an order by hand",
      description:
        "For an unreadable e-mail (`inboundEmailId`, hers) or from scratch. Validated at once (her lines get their " +
        "articles as with « C'est bon »), with its parcel when she gives a number.",
      request: body(manualOrderInputSchema),
      responses: {
        201: orderContent("Recorded and validated"),
        ...common,
        409: errorContent("The number is on another of her orders (tracking_exists)"),
        429: errorContent("Over 300 entries this hour (rate_limited)"),
      },
    }),
    "user",
  );

const trackingRoute = (limiter: MiddlewareHandler<AccessEnv>) =>
  defineAccess(
    createRoute({
      method: "post",
      path: "/me/items/{id}/tracking",
      middleware: [limiter],
      summary: "« Ajouter un numéro de suivi » on her article « Commandé »",
      description:
        "The carrier is read from the number's format, else the one she picked (`carrier`), else unknown: the parcel " +
        "is still kept (`unknown`). It joins the validated order of the article (200), or a new order `tracking` " +
        "(201). The same number twice is harmless.",
      request: { params: idParams, ...body(trackingInputSchema) },
      responses: {
        200: orderContent("Added to the article's order"),
        201: orderContent("A new order for the article"),
        ...common,
        409: errorContent(
          "In the trash (item_deleted), not « Commandé » (item_not_ordered), or the number is on another order " +
            "(tracking_exists)",
        ),
        429: errorContent("Over 300 entries this hour (rate_limited)"),
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

export function ordersRoutes(deps: WardrobeDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });
  // What she types by hand (orders, numbers) counts like the item creations: 300 an hour per account.
  const entries = deps.limits?.itemCreations ?? WARDROBE_LIMITS.itemCreations;
  const limiter = rateLimit<AccessEnv>({ ...entries, key: (c) => `orders:${c.var.session?.user.id ?? ""}` }, (c) =>
    c.json({ error: "rate_limited" } as const, 429),
  );
  /** Her account id, or null for a guest: orders are for accounts only, like her order address (spec §3.1). */
  async function accountIdOf(c: Context<AccessEnv>): Promise<string | null> {
    const userId = userIdOf(c);
    return (await accountOf(db, userId)) ? userId : null;
  }

  /** The order (200), or its error: 404 unknown, 409 a state that refuses the action. */
  const answer = <C extends Context<AccessEnv>>(c: C, outcome: OrderOutcome) => {
    if (!("error" in outcome)) return c.json(outcome.order, 200);
    return outcome.error === "not_found"
      ? c.json({ error: outcome.error }, 404)
      : c.json({ error: outcome.error }, 409);
  };
  /** As `answer`, 201 when the order was just created. */
  const answerCreated = <C extends Context<AccessEnv>>(c: C, outcome: OrderOutcome) =>
    !("error" in outcome) && outcome.created ? c.json(outcome.order, 201) : answer(c, outcome);

  return app
    .openapi(listRoute, async (c) => {
      const userId = await accountIdOf(c);
      if (!userId) return c.json(accountRequired, 403);
      return c.json({ orders: await listOrderViews(db, userId) }, 200);
    })
    .openapi(patchRoute, async (c) => {
      const userId = await accountIdOf(c);
      if (!userId) return c.json(accountRequired, 403);
      return answer(c, await patchOrder(db, userId, c.req.valid("param").id, c.req.valid("json"), now()));
    })
    .openapi(confirmRoute, async (c) => {
      const userId = await accountIdOf(c);
      if (!userId) return c.json(accountRequired, 403);
      return answer(c, await confirmOrder(db, userId, c.req.valid("param").id, now()));
    })
    .openapi(dismissRoute, async (c) => {
      const userId = await accountIdOf(c);
      if (!userId) return c.json(accountRequired, 403);
      return answer(c, await dismissOrder(db, userId, c.req.valid("param").id, now()));
    })
    .openapi(manualRoute(limiter), async (c) => {
      const userId = await accountIdOf(c);
      if (!userId) return c.json(accountRequired, 403);
      const outcome = await createManualOrder(db, userId, c.req.valid("json"), now());
      if ("error" in outcome) return outcome.error === "not_found" ? c.json(notFound, 404) : c.json(outcome, 409);
      return c.json(outcome.order, 201);
    })
    .openapi(trackingRoute(limiter), async (c) => {
      const userId = await accountIdOf(c);
      if (!userId) return c.json(accountRequired, 403);
      return answerCreated(c, await addItemTracking(db, userId, c.req.valid("param").id, c.req.valid("json"), now()));
    });
}
