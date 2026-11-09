import { createHash } from "node:crypto";
import { eq, schema } from "@closyria/db";
import {
  containsWebAddress,
  deviceKeySchema,
  giftDeleteSchema,
  giftInputSchema,
  opinionDeleteSchema,
  opinionInputSchema,
  opinionViewSchema,
  sharedWishlistViewSchema,
  wardrobeErrorSchema,
} from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type AccessEnv, defineAccess } from "../access";
import { clientAddress, rateLimit } from "../rate-limit";
import type { WardrobeDeps } from "../wardrobe/deps";
import { giveGift, leaveGift } from "../wardrobe/gifts";
import { deleteOpinion, upsertOpinion } from "../wardrobe/opinions";
import { hashShareToken, SHARE_TOKEN_PATTERN } from "../wardrobe/share-token";
import { loadSharedView } from "../wardrobe/wishlists";

const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: wardrobeErrorSchema } },
});

const sharedRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/shared/{token}",
    summary: "A shared list",
    description:
      "Public. Product data and her friends' opinions only (no notes, profiles or private photos; her size only " +
      "when the list is open to gifts). Never cached, never indexed. A malformed, unknown or stopped token " +
      "answers 404. The optional `x-device-key` header names the friend's device, so her own gifts show as hers " +
      "(`mine`); without it, or malformed, `mine` is null.",
    request: {
      params: z.object({ token: z.string() }),
      headers: z.object({ "x-device-key": z.string().optional() }),
    },
    responses: {
      200: { description: "The list", content: { "application/json": { schema: sharedWishlistViewSchema } } },
      404: errorContent("Unknown or stopped share (not_found)"),
    },
  }),
  "public",
);

const opinionParams = z.object({ token: z.string(), itemId: z.uuid() });
const MAX_OPINION_BODY_BYTES = 8 * 1024;
const OPINIONS_PER_HOUR_PER_DEVICE = 30;
const OPINIONS_PER_HOUR_PER_ADDRESS = 120;
const HOUR_MS = 60 * 60 * 1000;

/** The device key of the body (unvalidated here: validation comes after, a bad body just shares one bucket). */
async function deviceKeyOf(c: Context): Promise<string> {
  try {
    const body = (await c.req.raw.clone().json()) as { deviceKey?: unknown };
    const parsed = deviceKeySchema.safeParse(body.deviceKey);
    return parsed.success ? createHash("sha256").update(parsed.data).digest("hex") : "none";
  } catch {
    return "none";
  }
}

const rateLimited = (c: Context) => c.json({ error: "rate_limited" }, 429);

const putOpinionRoute = defineAccess(
  createRoute({
    method: "put",
    path: "/shared/{token}/items/{itemId}/opinion",
    summary: "A friend's opinion on an item of a shared list",
    description:
      "Public. Writes or replaces the opinion of the name, on the device that first used it (or with `claim`). " +
      "30 a hour per device and list, 120 per address and list.",
    middleware: [
      bodyLimit({ maxSize: MAX_OPINION_BODY_BYTES, onError: (c) => c.json({ error: "invalid_request" }, 413) }),
      rateLimit(
        {
          max: OPINIONS_PER_HOUR_PER_DEVICE,
          windowMs: HOUR_MS,
          key: async (c) => `d:${c.req.param("token")}:${await deviceKeyOf(c)}`,
        },
        rateLimited,
      ),
      rateLimit(
        {
          max: OPINIONS_PER_HOUR_PER_ADDRESS,
          windowMs: HOUR_MS,
          key: (c) => `a:${c.req.param("token")}:${clientAddress(c.req.raw.headers)}`,
        },
        rateLimited,
      ),
    ] as const,
    request: {
      params: opinionParams,
      body: { required: true, content: { "application/json": { schema: opinionInputSchema } } },
    },
    responses: {
      200: { description: "The opinion", content: { "application/json": { schema: opinionViewSchema } } },
      403: errorContent("Opinions are off (opinions_closed)"),
      404: errorContent("Unknown share or item not in the list (not_found)"),
      409: errorContent("Name used by another device (name_taken)"),
      422: errorContent("Web address in the name or the note (web_address)"),
      429: errorContent("Too many opinions (rate_limited)"),
    },
  }),
  "public",
);

const deleteOpinionRoute = defineAccess(
  createRoute({
    method: "delete",
    path: "/shared/{token}/items/{itemId}/opinion",
    summary: "Take back a friend's opinion",
    middleware: [
      bodyLimit({ maxSize: MAX_OPINION_BODY_BYTES, onError: (c) => c.json({ error: "invalid_request" }, 413) }),
    ] as const,
    request: {
      params: opinionParams,
      body: { required: true, content: { "application/json": { schema: opinionDeleteSchema } } },
    },
    responses: {
      204: { description: "Erased" },
      403: errorContent("The device is not attached to the name (forbidden)"),
      404: errorContent("Unknown or stopped share (not_found)"),
    },
  }),
  "public",
);

const giftParams = opinionParams;
const MAX_GIFT_BODY_BYTES = 4 * 1024;
const GIFTS_PER_HOUR_PER_DEVICE = 30;
const GIFTS_PER_HOUR_PER_ADDRESS = 120;
// One count for reserving, contributing and leaving alike, so both gift routes share these two limiters.
const giftLimits = [
  rateLimit(
    {
      max: GIFTS_PER_HOUR_PER_DEVICE,
      windowMs: HOUR_MS,
      key: async (c) => `d:${c.req.param("token")}:${await deviceKeyOf(c)}`,
    },
    rateLimited,
  ),
  rateLimit(
    {
      max: GIFTS_PER_HOUR_PER_ADDRESS,
      windowMs: HOUR_MS,
      key: (c) => `a:${c.req.param("token")}:${clientAddress(c.req.raw.headers)}`,
    },
    rateLimited,
  ),
] as const;
const giftBodyLimit = bodyLimit({
  maxSize: MAX_GIFT_BODY_BYTES,
  onError: (c) => c.json({ error: "invalid_request" }, 413),
});

const putGiftRoute = defineAccess(
  createRoute({
    method: "put",
    path: "/shared/{token}/items/{itemId}/gift",
    summary: "A friend offers an item of a shared list",
    description:
      "Public. `reserve` (« Je lui offre ») reserves the item, or answers 409 `already_reserved` with who did, " +
      "writing nothing; `join` (« Je participe ») contributes, or reserves when nobody has. Same name rule as the " +
      "opinions (`claim`). 30 gift actions an hour per device and list, 120 per address and list.",
    middleware: [giftBodyLimit, ...giftLimits] as const,
    request: {
      params: giftParams,
      body: { required: true, content: { "application/json": { schema: giftInputSchema } } },
    },
    responses: {
      200: {
        description: "Her role",
        content: {
          "application/json": {
            schema: z.object({ role: z.enum(["reserver", "contributor"]) }),
          },
        },
      },
      403: errorContent("The list is closed to gifts (gifts_closed)"),
      404: errorContent("Unknown share, or item not offered on the list (not_found)"),
      409: {
        description:
          "Name used by another device (name_taken), she took it herself (owner_took), or another friend " +
          "reserved it just before (already_reserved, with her name)",
        content: {
          "application/json": {
            schema: z.union([
              z.object({ error: z.literal("already_reserved"), reserver: z.string() }),
              wardrobeErrorSchema,
            ]),
          },
        },
      },
      422: errorContent("Web address in the name (web_address)"),
      429: errorContent("Too many gift actions (rate_limited)"),
    },
  }),
  "public",
);

const deleteGiftRoute = defineAccess(
  createRoute({
    method: "delete",
    path: "/shared/{token}/items/{itemId}/gift",
    summary: "A friend takes back her gift",
    description: "Public. With the device attached to the name. Counts in the same limits as offering.",
    middleware: [giftBodyLimit, ...giftLimits] as const,
    request: {
      params: giftParams,
      body: { required: true, content: { "application/json": { schema: giftDeleteSchema } } },
    },
    responses: {
      204: { description: "Taken back" },
      403: errorContent("The device is not attached to the name (forbidden)"),
      404: errorContent("Unknown or stopped share (not_found), or no gift under this name on the item (no_gift)"),
      429: errorContent("Too many gift actions (rate_limited)"),
    },
  }),
  "public",
);

/** A stopped share must not be served from a cache, and the page must stay out of search engines. */
function privateHeaders(c: { header: (name: string, value: string) => unknown }) {
  c.header("X-Robots-Tag", "noindex");
  c.header("Cache-Control", "no-store");
}

export function sharedRoutes(deps: WardrobeDeps) {
  const { db } = deps;
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json({ error: "invalid_request" } as const, 400)),
  });

  async function findList(token: string) {
    if (!SHARE_TOKEN_PATTERN.test(token)) return undefined;
    const [list] = await db
      .select({
        id: schema.wishlists.id,
        name: schema.wishlists.name,
        userId: schema.wishlists.userId,
        allowOpinions: schema.wishlists.allowOpinions,
        showOwnerName: schema.wishlists.showOwnerName,
        showOwnerOpinions: schema.wishlists.showOwnerOpinions,
        showBudget: schema.wishlists.showBudget,
        allowGifts: schema.wishlists.allowGifts,
        giftOccasion: schema.wishlists.giftOccasion,
        giftDate: schema.wishlists.giftDate,
      })
      .from(schema.wishlists)
      .where(eq(schema.wishlists.shareTokenHash, hashShareToken(token)));
    return list;
  }

  return app
    .openapi(sharedRoute, async (c) => {
      privateHeaders(c);
      const list = await findList(c.req.valid("param").token);
      if (!list) return c.json({ error: "not_found" } as const, 404);
      // Optional and never an error: a malformed key is no key.
      const deviceKey = deviceKeySchema.safeParse(c.req.valid("header")["x-device-key"]);
      return c.json(await loadSharedView(db, list, deviceKey.success ? deviceKey.data : null), 200);
    })
    .openapi(putOpinionRoute, async (c) => {
      privateHeaders(c);
      const { token, itemId } = c.req.valid("param");
      const input = c.req.valid("json");
      const list = await findList(token);
      if (!list) return c.json({ error: "not_found" } as const, 404);
      if (!list.allowOpinions) return c.json({ error: "opinions_closed" } as const, 403);
      if (containsWebAddress(input.name) || (input.note !== null && containsWebAddress(input.note)))
        return c.json({ error: "web_address" } as const, 422);
      const result = await upsertOpinion(db, {
        ...input,
        wishlistId: list.id,
        shareTokenHash: hashShareToken(token),
        itemId,
      });
      if (!result.ok) {
        if (result.error === "not_found") return c.json({ error: "not_found" } as const, 404);
        if (result.error === "opinions_closed") return c.json({ error: "opinions_closed" } as const, 403);
        return c.json({ error: "name_taken" } as const, 409);
      }
      return c.json(result.opinion, 200);
    })
    .openapi(deleteOpinionRoute, async (c) => {
      privateHeaders(c);
      const { token, itemId } = c.req.valid("param");
      const list = await findList(token);
      if (!list) return c.json({ error: "not_found" } as const, 404);
      const outcome = await deleteOpinion(db, { ...c.req.valid("json"), wishlistId: list.id, itemId });
      return outcome === "forbidden" ? c.json({ error: "forbidden" } as const, 403) : c.body(null, 204);
    })
    .openapi(putGiftRoute, async (c) => {
      privateHeaders(c);
      const { token, itemId } = c.req.valid("param");
      const input = c.req.valid("json");
      const list = await findList(token);
      if (!list) return c.json({ error: "not_found" } as const, 404);
      if (!list.allowGifts) return c.json({ error: "gifts_closed" } as const, 403);
      if (containsWebAddress(input.name)) return c.json({ error: "web_address" } as const, 422);
      const result = await giveGift(db, {
        ...input,
        wishlistId: list.id,
        shareTokenHash: hashShareToken(token),
        itemId,
      });
      if (result.ok) return c.json({ role: result.role }, 200);
      if (result.error === "already_reserved")
        return c.json({ error: "already_reserved", reserver: result.reserver } as const, 409);
      if (result.error === "not_found") return c.json({ error: "not_found" } as const, 404);
      if (result.error === "gifts_closed") return c.json({ error: "gifts_closed" } as const, 403);
      if (result.error === "owner_took") return c.json({ error: "owner_took" } as const, 409);
      return c.json({ error: "name_taken" } as const, 409);
    })
    .openapi(deleteGiftRoute, async (c) => {
      privateHeaders(c);
      const { token, itemId } = c.req.valid("param");
      const list = await findList(token);
      if (!list) return c.json({ error: "not_found" } as const, 404);
      const result = await leaveGift(db, {
        ...c.req.valid("json"),
        wishlistId: list.id,
        shareTokenHash: hashShareToken(token),
        itemId,
      });
      if (result.ok) return c.body(null, 204);
      if (result.error === "not_found") return c.json({ error: "not_found" } as const, 404);
      if (result.error === "no_gift") return c.json({ error: "no_gift" } as const, 404);
      return c.json({ error: "forbidden" } as const, 403);
    });
}
