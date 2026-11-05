import { and, count, eq, isNull, schema, sql } from "@closyria/db";
import {
  type ChildDetail,
  profileInputSchema,
  profileListSchema,
  profileOrderSchema,
  profilePatchSchema,
  profileViewSchema,
  summaryViewSchema,
  wardrobeErrorSchema,
} from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { type AccessEnv, defineAccess } from "../../access";
import type { WardrobeDeps } from "../../wardrobe/deps";
import { ensureDefaultProfile, findOwnProfile, listProfileViews, toProfileView } from "../../wardrobe/profiles";

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
const idParams = z.object({ id: z.uuid() });

const listRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/profiles",
    summary: "Her profiles",
    description: "In order, each with its number of active items. « Moi » is created on the first call.",
    responses: { 200: json("Her profiles", profileListSchema) },
  }),
  "user",
);

const createProfileRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/profiles",
    summary: "Create a profile",
    description: "Added after her other profiles. `childDetail` only with the `child` audience.",
    request: { body: { required: true, content: { "application/json": { schema: profileInputSchema } } } },
    responses: {
      201: json("Created", profileViewSchema),
      400: errorContent("Invalid body (invalid_request)"),
    },
  }),
  "user",
);

const patchProfileRoute = defineAccess(
  createRoute({
    method: "patch",
    path: "/me/profiles/{id}",
    summary: "Change a profile",
    description: "Leaving the `child` audience clears `childDetail`.",
    request: {
      params: idParams,
      body: { required: true, content: { "application/json": { schema: profilePatchSchema } } },
    },
    responses: {
      200: json("Changed", profileViewSchema),
      400: errorContent("Invalid body (invalid_request)"),
      404: errorContent("Unknown or another account's profile (not_found)"),
    },
  }),
  "user",
);

const deleteProfileRoute = defineAccess(
  createRoute({
    method: "delete",
    path: "/me/profiles/{id}",
    summary: "Delete an empty profile",
    description: "Refused while it holds items, trashed ones included.",
    request: { params: idParams },
    responses: {
      204: { description: "Deleted" },
      400: errorContent("Malformed id (invalid_request)"),
      404: errorContent("Unknown or another account's profile (not_found)"),
      409: errorContent("The profile holds items (profile_not_empty)"),
    },
  }),
  "user",
);

const orderRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/profiles/order",
    summary: "Reorder her profiles",
    description: "`ids`: every one of her profiles, exactly once, in the new order.",
    request: { body: { required: true, content: { "application/json": { schema: profileOrderSchema } } } },
    responses: {
      200: json("Her profiles in the new order", profileListSchema),
      400: errorContent("Not exactly her profiles (invalid_request)"),
      404: errorContent("Unknown or another account's profile (not_found)"),
    },
  }),
  "user",
);

const summaryRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/summary",
    summary: "What the app shell needs",
    description: "Whether the session is anonymous (account proposal), her active item count and her profiles.",
    responses: { 200: json("Summary", summaryViewSchema) },
  }),
  "user",
);

/** `user` access ran first: the session is there. */
function userIdOf(c: Context<AccessEnv>): string {
  const id = c.var.session?.user.id;
  if (!id) throw new Error("me route reached without a session");
  return id;
}

/** Postgres error code, through Drizzle's wrapping. */
function pgCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.cause?.code ?? e?.code;
}

/** The child detail a profile ends up with, or false when it contradicts the audience. */
function childDetailFor(audience: string, detail: ChildDetail | null | undefined): ChildDetail | null | false {
  if (audience !== "child") return detail ? false : null;
  return detail ?? null;
}

export function profilesRoutes(deps: WardrobeDeps) {
  const { db } = deps;
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });

  return app
    .openapi(listRoute, async (c) => c.json({ profiles: await listProfileViews(db, userIdOf(c)) }, 200))
    .openapi(createProfileRoute, async (c) => {
      const userId = userIdOf(c);
      const input = c.req.valid("json");
      const childDetail = childDetailFor(input.audience, input.childDetail);
      if (childDetail === false) return c.json(invalidRequest, 400);
      await ensureDefaultProfile(db, userId); // « Moi » comes first
      const [created] = await db
        .insert(schema.profiles)
        .values({
          userId,
          name: input.name,
          audience: input.audience,
          childDetail,
          color: input.color,
          position: sql`(select coalesce(max(position) + 1, 0) from ${schema.profiles} where user_id = ${userId})`,
        })
        .returning();
      if (!created) throw new Error("profile not inserted");
      return c.json(toProfileView(created), 201);
    })
    .openapi(patchProfileRoute, async (c) => {
      const userId = userIdOf(c);
      const patch = c.req.valid("json");
      const profile = await findOwnProfile(db, userId, c.req.valid("param").id);
      if (!profile) return c.json(notFound, 404);
      const audience = patch.audience ?? profile.audience;
      // Leaving `child` drops the stored detail; a detail sent along with another audience is refused.
      const childDetail = childDetailFor(
        audience,
        patch.childDetail !== undefined
          ? patch.childDetail
          : audience === "child"
            ? (profile.childDetail as ChildDetail | null)
            : null,
      );
      if (childDetail === false) return c.json(invalidRequest, 400);
      const [updated] = await db
        .update(schema.profiles)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.color !== undefined ? { color: patch.color } : {}),
          audience,
          childDetail,
        })
        .where(and(eq(schema.profiles.id, profile.id), eq(schema.profiles.userId, userId)))
        .returning();
      if (!updated) return c.json(notFound, 404);
      return c.json(toProfileView(updated), 200);
    })
    .openapi(deleteProfileRoute, async (c) => {
      const userId = userIdOf(c);
      const id = c.req.valid("param").id;
      try {
        const outcome = await db.transaction(async (tx) => {
          const [profile] = await tx
            .select({ id: schema.profiles.id })
            .from(schema.profiles)
            .where(and(eq(schema.profiles.id, id), eq(schema.profiles.userId, userId)))
            .for("update");
          if (!profile) return "not_found" as const;
          const [held] = await tx.select({ n: count() }).from(schema.items).where(eq(schema.items.profileId, id));
          if ((held?.n ?? 0) > 0) return "profile_not_empty" as const;
          await tx.delete(schema.profiles).where(eq(schema.profiles.id, id));
          return "deleted" as const;
        });
        if (outcome === "not_found") return c.json(notFound, 404);
        if (outcome === "profile_not_empty") return c.json({ error: outcome }, 409);
        return c.body(null, 204);
      } catch (error) {
        // An item kept into the profile meanwhile: the foreign key (no action) refuses the deletion.
        if (pgCode(error) === "23503") return c.json({ error: "profile_not_empty" } as const, 409);
        throw error;
      }
    })
    .openapi(orderRoute, async (c) => {
      const userId = userIdOf(c);
      const { ids } = c.req.valid("json");
      await ensureDefaultProfile(db, userId);
      const outcome = await db.transaction(async (tx) => {
        const own = await tx
          .select({ id: schema.profiles.id })
          .from(schema.profiles)
          .where(eq(schema.profiles.userId, userId))
          .for("update");
        const ownIds = new Set(own.map((p) => p.id));
        if (ids.some((id) => !ownIds.has(id))) return "not_found" as const;
        if (ids.length !== ownIds.size) return "invalid_request" as const;
        for (const [position, id] of ids.entries()) {
          await tx.update(schema.profiles).set({ position }).where(eq(schema.profiles.id, id));
        }
        return "ok" as const;
      });
      if (outcome === "not_found") return c.json(notFound, 404);
      if (outcome === "invalid_request") return c.json(invalidRequest, 400);
      return c.json({ profiles: await listProfileViews(db, userId) }, 200);
    })
    .openapi(summaryRoute, async (c) => {
      const userId = userIdOf(c);
      const profiles = await listProfileViews(db, userId);
      const [active] = await db
        .select({ n: count() })
        .from(schema.items)
        .where(and(eq(schema.items.userId, userId), isNull(schema.items.deletedAt)));
      return c.json(
        { isAnonymous: c.var.session?.user.isAnonymous === true, itemCount: active?.n ?? 0, profiles },
        200,
      );
    });
}
