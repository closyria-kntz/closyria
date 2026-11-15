import {
  manualOrderInputSchema,
  orderListSchema,
  orderPatchSchema,
  orderReceivedAnswerSchema,
  orderViewSchema,
  parcelPatchInputSchema,
  trackingInputSchema,
  wardrobeErrorSchema,
} from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import { type AccessEnv, defineAccess } from "../../access";
import { listOrderViews, listUnreadEmails } from "../../orders/view";
import {
  addItemTracking,
  answerReceived,
  confirmOrder,
  createManualOrder,
  deleteParcel,
  dismissOrder,
  dismissUnreadEmail,
  type OrderOutcome,
  patchOrder,
  patchParcel,
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
    description:
      "Drafts read from her e-mails and validated orders, newest first (100 at most); dismissed ones are not listed. " +
      "With her e-mails nothing could read (`unreadEmails`: failed, kept, not set aside, no order typed from them). " +
      "Accounts only.",
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

const receivedRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/orders/{id}/received",
    summary: "« Tu as reçu ta commande ? »: « Oui » or « Pas encore »",
    description:
      "`yes`: her articles of the order still « Commandé » go to « Reçu » now, with the return deadline (the shop's " +
      "delay, 14 days without one), and its parcels are no longer checked. `not_yet`: the question comes back once, " +
      "20 days after the shipping. Idempotent.",
    request: { params: idParams, ...body(orderReceivedAnswerSchema) },
    responses: {
      200: orderContent("Answered"),
      ...common,
      409: errorContent("Not validated yet (order_not_confirmed), or dismissed (order_dismissed)"),
    },
  }),
  "user",
);

const parcelParams = z.object({ id: z.uuid(), parcelId: z.uuid() });

/** Carrier or number corrections per account and day. */
const PARCEL_EDITS_PER_DAY = 30;

const parcelPatchRoute = (limiter: MiddlewareHandler<AccessEnv>) =>
  defineAccess(
    createRoute({
      method: "patch",
      path: "/me/orders/{id}/parcels/{parcelId}",
      summary: "« Changer de transporteur » or « Modifier le numéro » on one of her parcels",
      description:
        "The carrier she picked, a new number, or both; the tracking starts again (step `pending`, failures reset, " +
        "asked at the next sweep; a tracking already over gets 30 more days). A new number drops the old one's steps " +
        "and notifications, and its carrier is read from its format unless she picked one (none: `unknown`).",
      request: { params: parcelParams, ...body(parcelPatchInputSchema) },
      responses: {
        200: orderContent("The order with the corrected parcel"),
        ...common,
        409: errorContent(
          "Delivered already (parcel_delivered), the order is dismissed (order_dismissed), the number is on another " +
            "parcel of the order (parcel_exists) or on another of her orders (tracking_exists)",
        ),
        429: errorContent("Too many corrections (rate_limited): each new number costs one tracking registration"),
      },
      middleware: [limiter],
    }),
    "user",
  );

const parcelDeleteRoute = defineAccess(
  createRoute({
    method: "delete",
    path: "/me/orders/{id}/parcels/{parcelId}",
    summary: "« Supprimer ce suivi » on one of her parcels",
    description:
      "The parcel goes with its steps and notifications; the order and its articles stay (what a delivery brought " +
      "is kept). A validated order is settled again: its parcels left all settled with one delivered, its articles " +
      "move to « Reçu ».",
    request: { params: parcelParams },
    responses: {
      200: orderContent("The order without the parcel"),
      ...common,
      409: errorContent("The order is dismissed (order_dismissed)"),
    },
  }),
  "user",
);

const dismissEmailRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/order-emails/{id}/dismiss",
    summary: "« Ce n'est pas une commande » on an e-mail nothing could read",
    description: "No longer listed in `unreadEmails`; twice is harmless.",
    request: { params: idParams },
    responses: {
      200: { description: "Her orders, as listed", content: { "application/json": { schema: orderListSchema } } },
      ...common,
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
        409: errorContent(
          "The number is on another of her orders (tracking_exists), or the e-mail already has its order (order_exists)",
        ),
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
  // Each new number is one registration at the tracking aggregator (a paid quota): corrections are few.
  const parcelLimiter = rateLimit<AccessEnv>(
    {
      max: PARCEL_EDITS_PER_DAY,
      windowMs: 24 * 60 * 60 * 1000,
      key: (c) => `parcel-edits:${c.var.session?.user.id ?? ""}`,
    },
    (c) => c.json({ error: "rate_limited" } as const, 429),
  );
  /** Her account id, or null for a guest: orders are for accounts only, like her order address (spec §3.1). */
  async function accountIdOf(c: Context<AccessEnv>): Promise<string | null> {
    const userId = userIdOf(c);
    return (await accountOf(db, userId)) ? userId : null;
  }

  const listAll = async (userId: string) => ({
    orders: await listOrderViews(db, userId),
    unreadEmails: await listUnreadEmails(db, userId, now()),
  });

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
      return c.json(await listAll(userId), 200);
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
    .openapi(receivedRoute, async (c) => {
      const userId = await accountIdOf(c);
      if (!userId) return c.json(accountRequired, 403);
      return answer(c, await answerReceived(db, userId, c.req.valid("param").id, c.req.valid("json"), now()));
    })
    .openapi(parcelPatchRoute(parcelLimiter), async (c) => {
      const userId = await accountIdOf(c);
      if (!userId) return c.json(accountRequired, 403);
      const { id, parcelId } = c.req.valid("param");
      return answer(c, await patchParcel(db, userId, id, parcelId, c.req.valid("json"), now()));
    })
    .openapi(parcelDeleteRoute, async (c) => {
      const userId = await accountIdOf(c);
      if (!userId) return c.json(accountRequired, 403);
      const { id, parcelId } = c.req.valid("param");
      return answer(c, await deleteParcel(db, userId, id, parcelId, now()));
    })
    .openapi(dismissEmailRoute, async (c) => {
      const userId = await accountIdOf(c);
      if (!userId) return c.json(accountRequired, 403);
      if (!(await dismissUnreadEmail(db, userId, c.req.valid("param").id, now()))) return c.json(notFound, 404);
      return c.json(await listAll(userId), 200);
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
