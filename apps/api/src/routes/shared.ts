import { createHash } from "node:crypto";
import { eq, schema } from "@closyria/db";
import {
  containsWebAddress,
  deviceKeySchema,
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
      "Public. Product data and her friends' opinions only (no notes, sizes, profiles or private photos). " +
      "Never cached, never indexed. A malformed, unknown or stopped token answers 404.",
    request: { params: z.object({ token: z.string() }) },
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
      422: errorContent("Web address in the note (web_address)"),
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
      return c.json(await loadSharedView(db, list), 200);
    })
    .openapi(putOpinionRoute, async (c) => {
      privateHeaders(c);
      const { token, itemId } = c.req.valid("param");
      const input = c.req.valid("json");
      const list = await findList(token);
      if (!list) return c.json({ error: "not_found" } as const, 404);
      if (!list.allowOpinions) return c.json({ error: "opinions_closed" } as const, 403);
      if (input.note !== null && containsWebAddress(input.note)) return c.json({ error: "web_address" } as const, 422);
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
    });
}
