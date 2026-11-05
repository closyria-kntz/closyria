import { and, asc, count, eq, schema, sql } from "@closyria/db";
import {
  MAX_TAGS_PER_ACCOUNT,
  type ProfileColor,
  type TagView,
  tagInputSchema,
  tagListSchema,
  tagPatchSchema,
  tagViewSchema,
  wardrobeErrorSchema,
} from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { type AccessEnv, defineAccess } from "../../access";
import { pgCode } from "../../pg-code";
import type { WardrobeDeps } from "../../wardrobe/deps";

const invalidRequest = { error: "invalid_request" } as const;
const notFound = { error: "not_found" } as const;
const tagExists = { error: "tag_exists" } as const;
const tagLimit = { error: "tag_limit" } as const;
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
const notFoundContent = errorContent("Unknown or another account's tag (not_found)");
const existsContent = errorContent("She already has a tag of that name, case ignored (tag_exists)");

const listRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/tags",
    summary: "Her tags",
    description: "By name, case ignored.",
    responses: { 200: json("Her tags", tagListSchema) },
  }),
  "user",
);

const createTagRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/tags",
    summary: "Create a tag",
    description: "At most 200 tags per account.",
    request: body(tagInputSchema),
    responses: {
      201: json("Created", tagViewSchema),
      400: errorContent("Invalid body (invalid_request)"),
      409: errorContent("Name taken, case ignored (tag_exists), or already 200 tags (tag_limit)"),
    },
  }),
  "user",
);

const patchTagRoute = defineAccess(
  createRoute({
    method: "patch",
    path: "/me/tags/{id}",
    summary: "Rename or recolour a tag",
    description: "`color: null` removes the colour.",
    request: { params: idParams, ...body(tagPatchSchema) },
    responses: {
      200: json("Changed", tagViewSchema),
      400: errorContent("Invalid body (invalid_request)"),
      404: notFoundContent,
      409: existsContent,
    },
  }),
  "user",
);

const deleteTagRoute = defineAccess(
  createRoute({
    method: "delete",
    path: "/me/tags/{id}",
    summary: "Delete a tag",
    description: "The tag is taken off her items; the items stay.",
    request: { params: idParams },
    responses: {
      204: { description: "Deleted" },
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

const byName = new Intl.Collator("fr", { sensitivity: "base" });

const toTagView = (tag: typeof schema.tags.$inferSelect): TagView => ({
  id: tag.id,
  name: tag.name,
  color: tag.color as ProfileColor | null,
});

/** Runs a write that may hit the unique (user, lower(name)) index: null when the name is taken. */
async function unlessNameTaken<T>(write: () => Promise<T>): Promise<T | null> {
  try {
    return await write();
  } catch (error) {
    if (pgCode(error) === "23505") return null;
    throw error;
  }
}

export function tagsRoutes(deps: WardrobeDeps) {
  const { db } = deps;
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });
  const own = (userId: string, id: string) => and(eq(schema.tags.id, id), eq(schema.tags.userId, userId));

  return app
    .openapi(listRoute, async (c) => {
      const rows = await db
        .select()
        .from(schema.tags)
        .where(eq(schema.tags.userId, userIdOf(c)))
        .orderBy(asc(schema.tags.id));
      // French order, case and accents ignored (the database collation would put « été » after « Vinted »).
      rows.sort((a, b) => byName.compare(a.name, b.name));
      return c.json({ tags: rows.map(toTagView) }, 200);
    })
    .openapi(createTagRoute, async (c) => {
      const userId = userIdOf(c);
      const input = c.req.valid("json");
      const created = await unlessNameTaken(() =>
        db.transaction(async (tx) => {
          // Count and insert under a per-user lock: two creations at once cannot both pass the cap.
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tags:${userId}`}, 0))`);
          const [held] = await tx.select({ n: count() }).from(schema.tags).where(eq(schema.tags.userId, userId));
          if ((held?.n ?? 0) >= MAX_TAGS_PER_ACCOUNT) return "limit" as const;
          const [tag] = await tx
            .insert(schema.tags)
            .values({ userId, name: input.name, color: input.color ?? null })
            .returning();
          if (!tag) throw new Error("tag not inserted");
          return tag;
        }),
      );
      if (created === null) return c.json(tagExists, 409);
      if (created === "limit") return c.json(tagLimit, 409);
      return c.json(toTagView(created), 201);
    })
    .openapi(patchTagRoute, async (c) => {
      const userId = userIdOf(c);
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json");
      const set = {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {}),
      };
      if (Object.keys(set).length === 0) {
        const [tag] = await db.select().from(schema.tags).where(own(userId, id));
        return tag ? c.json(toTagView(tag), 200) : c.json(notFound, 404);
      }
      const updated = await unlessNameTaken(() => db.update(schema.tags).set(set).where(own(userId, id)).returning());
      if (!updated) return c.json(tagExists, 409);
      const [tag] = updated;
      return tag ? c.json(toTagView(tag), 200) : c.json(notFound, 404);
    })
    .openapi(deleteTagRoute, async (c) => {
      // item_tags rows go with the tag (cascade); the items stay.
      const [deleted] = await db
        .delete(schema.tags)
        .where(own(userIdOf(c), c.req.valid("param").id))
        .returning({ id: schema.tags.id });
      return deleted ? c.body(null, 204) : c.json(notFound, 404);
    });
}
