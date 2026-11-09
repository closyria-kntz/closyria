import { and, asc, eq, isNull, schema, sql } from "@closyria/db";
import {
  containsWebAddress,
  erasedOpinionSchema,
  giftSettingsPatchSchema,
  itemOpinionsSchema,
  type OpinionView,
  shareLinkSchema,
  shareResultSchema,
  wardrobeErrorSchema,
  wishlistInputSchema,
  wishlistItemInputSchema,
  wishlistListSchema,
  wishlistOpinionsSchema,
  wishlistOrderSchema,
  wishlistSettingsSchema,
  wishlistsOrderSchema,
  wishlistViewSchema,
} from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { type AccessEnv, defineAccess } from "../../access";
import { runBulk } from "../../wardrobe/bulk";
import { trackWishlistShared, type WardrobeDeps } from "../../wardrobe/deps";
import { markGiftsRemoved } from "../../wardrobe/gifts";
import { eraseOpinion, opinionsByItem, restoreOpinion } from "../../wardrobe/opinions";
import { decryptShareToken, encryptShareToken } from "../../wardrobe/share-link";
import { newShareToken } from "../../wardrobe/share-token";
import { listWishlistViews } from "../../wardrobe/wishlists";

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
const wishlistPatchSchema = wishlistInputSchema
  .partial()
  .extend(wishlistSettingsSchema.partial().shape)
  .extend(giftSettingsPatchSchema.shape)
  .refine((patch) => Object.values(patch).some((v) => v !== undefined), "empty patch");
const idParams = z.object({ id: z.uuid() });
const itemParams = z.object({ id: z.uuid(), itemId: z.uuid() });
const notFoundContent = errorContent("Unknown or another account's list or item (not_found)");

const listRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/wishlists",
    summary: "Her lists",
    description: "In order; each with its items (not in the trash) in list order and whether it is shared.",
    responses: { 200: json("Her lists", wishlistListSchema) },
  }),
  "user",
);

const createListRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/wishlists",
    summary: "Create a list",
    description: "Added after her other lists.",
    request: body(wishlistInputSchema),
    responses: { 201: json("Created", wishlistViewSchema), 400: errorContent("Invalid body (invalid_request)") },
  }),
  "user",
);

const patchListRoute = defineAccess(
  createRoute({
    method: "patch",
    path: "/me/wishlists/{id}",
    summary: "Rename a list or change how it is shared",
    description:
      "`name` and/or the sharing settings (`allowOpinions`, `showOwnerName`, `showOwnerOpinions`, `showBudget`); at least one.",
    request: { params: idParams, ...body(wishlistPatchSchema) },
    responses: {
      200: json("Changed", wishlistViewSchema),
      400: errorContent("Invalid body (invalid_request)"),
      404: notFoundContent,
    },
  }),
  "user",
);

const deleteListRoute = defineAccess(
  createRoute({
    method: "delete",
    path: "/me/wishlists/{id}",
    summary: "Delete a list",
    description: "The items stay; a share of the list ends with it.",
    request: { params: idParams },
    responses: {
      204: { description: "Deleted" },
      400: errorContent("Malformed id (invalid_request)"),
      404: notFoundContent,
    },
  }),
  "user",
);

const addItemRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/wishlists/{id}/items",
    summary: "Put an item in a list",
    description: "Already in the list: nothing changes. Added at the end.",
    request: { params: idParams, ...body(wishlistItemInputSchema) },
    responses: {
      200: json("The list", wishlistViewSchema),
      400: errorContent("Invalid body (invalid_request)"),
      404: notFoundContent,
      409: errorContent("The item is in the trash (item_deleted)"),
    },
  }),
  "user",
);

const removeItemRoute = defineAccess(
  createRoute({
    method: "delete",
    path: "/me/wishlists/{id}/items/{itemId}",
    summary: "Take an item out of a list",
    description: "Not in the list: nothing changes.",
    request: { params: itemParams },
    responses: {
      200: json("The list", wishlistViewSchema),
      400: errorContent("Malformed id (invalid_request)"),
      404: notFoundContent,
    },
  }),
  "user",
);

const orderRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/wishlists/{id}/order",
    summary: "Reorder the items of a list",
    description: "`ids`: every item of the list (not in the trash), exactly once, in the new order.",
    request: { params: idParams, ...body(wishlistOrderSchema) },
    responses: {
      200: json("The list in the new order", wishlistViewSchema),
      400: errorContent("Not exactly the list's items (invalid_request)"),
      404: notFoundContent,
    },
  }),
  "user",
);

const listsOrderRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/wishlists/order",
    summary: "Reorder her lists",
    description: "`ids`: every one of her lists, exactly once, in the new order.",
    request: body(wishlistsOrderSchema),
    responses: {
      200: json("Her lists in the new order", wishlistListSchema),
      400: errorContent("Not exactly her lists (invalid_request)"),
      404: notFoundContent,
    },
  }),
  "user",
);

const shareRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/wishlists/{id}/share",
    summary: "Share a list by a link",
    description:
      "Returns `/l/<token>`; she can read it again with `GET`. Each call makes a new token; the previous link stops working (the friends' opinions stay).",
    request: { params: idParams },
    responses: {
      200: json("The link", shareResultSchema),
      400: errorContent("Malformed id (invalid_request)"),
      404: notFoundContent,
    },
  }),
  "user",
);

const getShareRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/wishlists/{id}/share",
    summary: "The link of a shared list",
    description:
      "`url` is `/l/<token>`; null when the list is not shared, or when it was shared before links were kept (`legacy`: share again to get a link).",
    request: { params: idParams },
    responses: {
      200: json("The link", shareLinkSchema),
      400: errorContent("Malformed id (invalid_request)"),
      404: notFoundContent,
    },
  }),
  "user",
);

const unshareRoute = defineAccess(
  createRoute({
    method: "delete",
    path: "/me/wishlists/{id}/share",
    summary: "Stop sharing a list",
    description:
      "The link stops working; the friends' opinions stay (she still reads them, a new share shows them). Not shared: nothing changes.",
    request: { params: idParams },
    responses: {
      204: { description: "Stopped" },
      400: errorContent("Malformed id (invalid_request)"),
      404: notFoundContent,
    },
  }),
  "user",
);

const opinionParams = z.object({ id: z.uuid(), opinionId: z.uuid() });

const opinionsRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/wishlists/{id}/opinions",
    summary: "Her friends' opinions of a list",
    description: "By item, oldest first. `isNew`: written or changed since she last marked them seen.",
    request: { params: idParams },
    responses: {
      200: json("The opinions", wishlistOpinionsSchema),
      400: errorContent("Malformed id (invalid_request)"),
      404: notFoundContent,
    },
  }),
  "user",
);

const opinionsSeenRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/wishlists/{id}/opinions/seen",
    summary: "Mark the opinions of a list as seen",
    request: { params: idParams },
    responses: {
      204: { description: "Marked" },
      400: errorContent("Malformed id (invalid_request)"),
      404: notFoundContent,
    },
  }),
  "user",
);

const opinionRestoreRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/wishlists/{id}/opinions/restore",
    summary: "Put back an opinion she erased",
    description: "Body: the erased opinion as `DELETE` returned it. Same id and dates. Shared or not.",
    request: { params: idParams, ...body(z.object({ opinion: erasedOpinionSchema }).or(erasedOpinionSchema)) },
    responses: {
      201: json("Restored", z.object({ opinion: erasedOpinionSchema })),
      400: errorContent("Invalid body (invalid_request)"),
      404: errorContent("Unknown or no longer shared list, or the item is no longer in it (not_found)"),
      409: errorContent("Another opinion has the same name on that item meanwhile (opinion_exists)"),
      422: errorContent("Web address in the name or the note (web_address)"),
    },
  }),
  "user",
);

const opinionDeleteRoute = defineAccess(
  createRoute({
    method: "delete",
    path: "/me/wishlists/{id}/opinions/{opinionId}",
    summary: "Erase a friend's opinion",
    request: { params: opinionParams },
    responses: {
      200: json("The erased opinion", z.object({ opinion: erasedOpinionSchema })),
      400: errorContent("Malformed id (invalid_request)"),
      404: notFoundContent,
    },
  }),
  "user",
);

const itemOpinionsRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/items/{id}/opinions",
    summary: "Friends' opinions of an item",
    description: "In her lists that hold it (shared or no longer), by list name; lists without opinion are left out.",
    request: { params: idParams },
    responses: {
      200: json("The opinions", itemOpinionsSchema),
      400: errorContent("Malformed id (invalid_request)"),
      404: notFoundContent,
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

export function wishlistsRoutes(deps: WardrobeDeps) {
  const { db, shareLinkKey } = deps;
  const now = () => deps.now?.() ?? new Date();
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });
  const own = (userId: string, id: string) => and(eq(schema.wishlists.id, id), eq(schema.wishlists.userId, userId));
  const viewOf = async (userId: string, id: string) => (await listWishlistViews(db, userId, id))[0];

  return app
    .openapi(listRoute, async (c) => c.json({ wishlists: await listWishlistViews(db, userIdOf(c)) }, 200))
    .openapi(createListRoute, async (c) => {
      const userId = userIdOf(c);
      const { name } = c.req.valid("json");
      const created = await db.transaction(async (tx) => {
        // Position after her other lists, under a per-user lock: two creations at once get different positions.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`wishlists:${userId}`}, 0))`);
        const [last] = await tx
          .select({ max: sql<number | null>`max(${schema.wishlists.position})` })
          .from(schema.wishlists)
          .where(eq(schema.wishlists.userId, userId));
        const position = last?.max === null || last?.max === undefined ? 0 : Number(last.max) + 1;
        const [row] = await tx.insert(schema.wishlists).values({ userId, name, position }).returning();
        if (!row) throw new Error("wishlist not inserted");
        return row;
      });
      const view = await viewOf(userId, created.id);
      if (!view) throw new Error("wishlist not readable");
      return c.json(view, 201);
    })
    .openapi(listsOrderRoute, async (c) => {
      const userId = userIdOf(c);
      const { ids } = c.req.valid("json");
      const outcome = await db.transaction(async (tx) => {
        // The lock of the creation: no list appears while we order.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`wishlists:${userId}`}, 0))`);
        const owned = await tx
          .select({ id: schema.wishlists.id })
          .from(schema.wishlists)
          .where(eq(schema.wishlists.userId, userId))
          .orderBy(asc(schema.wishlists.id))
          .for("update");
        const ownIds = new Set(owned.map((w) => w.id));
        if (ids.some((id) => !ownIds.has(id))) return "not_found" as const;
        if (ids.length !== ownIds.size) return "invalid_request" as const;
        await tx.execute(sql`
          update wishlists set position = o.position
          from (values ${sql.join(
            ids.map((id, position) => sql`(${id}::uuid, ${position}::int)`),
            sql`, `,
          )}) as o(id, position)
          where wishlists.id = o.id`);
        return "ok" as const;
      });
      if (outcome === "not_found") return c.json(notFound, 404);
      if (outcome === "invalid_request") return c.json(invalidRequest, 400);
      return c.json({ wishlists: await listWishlistViews(db, userId) }, 200);
    })
    .openapi(patchListRoute, async (c) => {
      const userId = userIdOf(c);
      const { id } = c.req.valid("param");
      const [row] = await db
        .update(schema.wishlists)
        .set(c.req.valid("json"))
        .where(own(userId, id))
        .returning({ id: schema.wishlists.id });
      const view = row ? await viewOf(userId, id) : undefined;
      return view ? c.json(view, 200) : c.json(notFound, 404);
    })
    .openapi(opinionsRoute, async (c) => {
      const [list] = await db
        .select({ seenAt: schema.wishlists.opinionsSeenAt })
        .from(schema.wishlists)
        .where(own(userIdOf(c), c.req.valid("param").id));
      if (!list) return c.json(notFound, 404);
      const byItem = await opinionsByItem(db, c.req.valid("param").id, list.seenAt);
      return c.json({ items: [...byItem].map(([itemId, opinions]) => ({ itemId, opinions })) }, 200);
    })
    .openapi(opinionsSeenRoute, async (c) => {
      const [row] = await db
        .update(schema.wishlists)
        .set({ opinionsSeenAt: sql`now()` })
        .where(own(userIdOf(c), c.req.valid("param").id))
        .returning({ id: schema.wishlists.id });
      return row ? c.body(null, 204) : c.json(notFound, 404);
    })
    .openapi(opinionRestoreRoute, async (c) => {
      const { id } = c.req.valid("param");
      const sent = c.req.valid("json");
      const opinion = "opinion" in sent ? sent.opinion : sent;
      if (containsWebAddress(opinion.name) || (opinion.note !== null && containsWebAddress(opinion.note)))
        return c.json({ error: "web_address" } as const, 422);
      const [list] = await db
        .select({ id: schema.wishlists.id })
        .from(schema.wishlists)
        .where(own(userIdOf(c), id));
      if (!list) return c.json(notFound, 404);
      const outcome = await restoreOpinion(db, id, opinion);
      if (outcome === "not_found") return c.json(notFound, 404);
      if (outcome === "exists") return c.json({ error: "opinion_exists" } as const, 409);
      return c.json({ opinion }, 201);
    })
    .openapi(opinionDeleteRoute, async (c) => {
      const { id, opinionId } = c.req.valid("param");
      const [list] = await db
        .select({ id: schema.wishlists.id })
        .from(schema.wishlists)
        .where(own(userIdOf(c), id));
      const opinion = list ? await eraseOpinion(db, id, opinionId) : null;
      return opinion ? c.json({ opinion }, 200) : c.json(notFound, 404);
    })
    .openapi(itemOpinionsRoute, async (c) => {
      const userId = userIdOf(c);
      const { id } = c.req.valid("param");
      const [item] = await db
        .select({ id: schema.items.id })
        .from(schema.items)
        .where(and(eq(schema.items.id, id), eq(schema.items.userId, userId)));
      if (!item) return c.json(notFound, 404);
      const lists = await db
        .select({ id: schema.wishlists.id, name: schema.wishlists.name, seenAt: schema.wishlists.opinionsSeenAt })
        .from(schema.wishlists)
        .where(eq(schema.wishlists.userId, userId))
        .orderBy(asc(schema.wishlists.id));
      const out: { wishlistId: string; wishlistName: string; opinions: OpinionView[] }[] = [];
      for (const list of lists) {
        const opinions = (await opinionsByItem(db, list.id, list.seenAt)).get(id);
        if (opinions?.length) out.push({ wishlistId: list.id, wishlistName: list.name, opinions });
      }
      out.sort(
        (a, b) => a.wishlistName.localeCompare(b.wishlistName, "fr") || a.wishlistId.localeCompare(b.wishlistId),
      );
      return c.json({ lists: out }, 200);
    })
    .openapi(deleteListRoute, async (c) => {
      // wishlist_items rows go with the list (cascade); the items stay.
      const [deleted] = await db
        .delete(schema.wishlists)
        .where(own(userIdOf(c), c.req.valid("param").id))
        .returning({ id: schema.wishlists.id });
      return deleted ? c.body(null, 204) : c.json(notFound, 404);
    })
    .openapi(addItemRoute, async (c) => {
      const userId = userIdOf(c);
      const { id } = c.req.valid("param");
      // The same locks and checks as the bulk "addToList": list and item must be hers, the item not in the trash.
      const outcome = await runBulk(
        db,
        userId,
        { op: "addToList", ids: [c.req.valid("json").itemId], wishlistId: id },
        now(),
      );
      if ("error" in outcome) {
        if (outcome.error === "item_deleted") return c.json({ error: "item_deleted" } as const, 409);
        return c.json(notFound, 404);
      }
      const view = await viewOf(userId, id);
      return view ? c.json(view, 200) : c.json(notFound, 404);
    })
    .openapi(removeItemRoute, async (c) => {
      const userId = userIdOf(c);
      const { id, itemId } = c.req.valid("param");
      const found = await db.transaction(async (tx) => {
        const [list] = await tx
          .select({ id: schema.wishlists.id })
          .from(schema.wishlists)
          .where(own(userId, id))
          .for("share");
        const [item] = await tx
          .select({ id: schema.items.id })
          .from(schema.items)
          .where(and(eq(schema.items.id, itemId), eq(schema.items.userId, userId)));
        if (!list || !item) return false;
        // Her friends' gifts stay, marked, so the givers learn she took it off; putting it back restores them.
        // Before the delete (lock order, see markGiftsRemoved).
        await markGiftsRemoved(tx, id, [itemId]);
        await tx
          .delete(schema.wishlistItems)
          .where(and(eq(schema.wishlistItems.wishlistId, id), eq(schema.wishlistItems.itemId, itemId)));
        // Her friends' opinions on this item belong to this list only.
        await tx
          .delete(schema.wishlistOpinions)
          .where(and(eq(schema.wishlistOpinions.wishlistId, id), eq(schema.wishlistOpinions.itemId, itemId)));
        return true;
      });
      const view = found ? await viewOf(userId, id) : undefined;
      return view ? c.json(view, 200) : c.json(notFound, 404);
    })
    .openapi(orderRoute, async (c) => {
      const userId = userIdOf(c);
      const { id } = c.req.valid("param");
      const { ids } = c.req.valid("json");
      const outcome = await db.transaction(async (tx) => {
        // Exclusive lock on the list: an addition (share lock) waits, so the set cannot change under us.
        const [list] = await tx
          .select({ id: schema.wishlists.id })
          .from(schema.wishlists)
          .where(own(userId, id))
          .for("update");
        if (!list) return "not_found" as const;
        const current = await tx
          .select({ itemId: schema.wishlistItems.itemId })
          .from(schema.wishlistItems)
          .innerJoin(schema.items, eq(schema.items.id, schema.wishlistItems.itemId))
          .where(and(eq(schema.wishlistItems.wishlistId, id), isNull(schema.items.deletedAt)))
          .orderBy(asc(schema.wishlistItems.itemId));
        const held = new Set(current.map((r) => r.itemId));
        if (ids.length !== held.size || ids.some((itemId) => !held.has(itemId))) return "invalid_request" as const;
        if (ids.length > 0) {
          await tx.execute(sql`
            update wishlist_items set position = o.position
            from (values ${sql.join(
              ids.map((itemId, position) => sql`(${itemId}::uuid, ${position}::int)`),
              sql`, `,
            )}) as o(item_id, position)
            where wishlist_items.wishlist_id = ${id} and wishlist_items.item_id = o.item_id`);
        }
        return "ok" as const;
      });
      if (outcome === "not_found") return c.json(notFound, 404);
      if (outcome === "invalid_request") return c.json(invalidRequest, 400);
      const view = await viewOf(userId, id);
      return view ? c.json(view, 200) : c.json(notFound, 404);
    })
    .openapi(shareRoute, async (c) => {
      const userId = userIdOf(c);
      const { id } = c.req.valid("param");
      const { token, hash } = newShareToken();
      const [shared] = await db
        .update(schema.wishlists)
        .set({ shareTokenHash: hash, shareTokenEncrypted: encryptShareToken(token, shareLinkKey), sharedAt: now() })
        .where(own(userId, id))
        .returning({ id: schema.wishlists.id });
      if (!shared) return c.json(notFound, 404);
      await trackWishlistShared(db, userId);
      return c.json({ url: `/l/${token}` }, 200);
    })
    .openapi(getShareRoute, async (c) => {
      const [row] = await db
        .select({ hash: schema.wishlists.shareTokenHash, encrypted: schema.wishlists.shareTokenEncrypted })
        .from(schema.wishlists)
        .where(own(userIdOf(c), c.req.valid("param").id));
      if (!row) return c.json(notFound, 404);
      const token = row.encrypted ? decryptShareToken(row.encrypted, shareLinkKey) : null;
      if (token) return c.json({ url: `/l/${token}`, legacy: false }, 200);
      // Kept but unreadable: altered, or SHARE_LINK_KEY changed. Never log the value or the key.
      if (row.encrypted) console.warn(`share link of list ${c.req.valid("param").id} cannot be decrypted`);
      return c.json({ url: null, legacy: row.hash !== null }, 200);
    })
    .openapi(unshareRoute, async (c) => {
      const userId = userIdOf(c);
      const { id } = c.req.valid("param");
      const found = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.wishlists)
          .set({ shareTokenHash: null, shareTokenEncrypted: null, sharedAt: null })
          .where(own(userId, id))
          .returning({ id: schema.wishlists.id });
        // The friends' opinions and devices stay: she still reads them, and a new share shows them again.
        return row !== undefined;
      });
      return found ? c.body(null, 204) : c.json(notFound, 404);
    });
}
