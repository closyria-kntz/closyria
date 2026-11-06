import { and, asc, type Database, eq, schema, sql } from "@closyria/db";
import {
  adminCatalogErrorSchema,
  type ReferenceEntry,
  type ReferenceKind,
  referenceCreateSchemas,
  referenceDeletedSchema,
  referenceEntrySchema,
  referenceKindSchema,
  referenceListSchema,
  referencePatchSchemas,
} from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { defineAccess } from "../../access";
import { type AdminEnv, noteAudit } from "../../admin-audit";
import type { CatalogDeps } from "../../catalog/deps";

const invalidRequest = { error: "invalid_request" } as const;
const notFound = { error: "not_found" } as const;
const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: adminCatalogErrorSchema } },
});
const kindParam = z.object({ kind: referenceKindSchema });
const entryParams = z.object({ kind: referenceKindSchema, id: z.uuid() });
// The body is checked against the schema of its kind in the handler.
const looseBody = { required: true, content: { "application/json": { schema: z.record(z.string(), z.unknown()) } } };

const listRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/admin/reference/{kind}",
    summary: "A reference list: categories (flat, with parentId), colors, materials or patterns",
    request: { params: kindParam },
    responses: { 200: { description: "Entries", content: { "application/json": { schema: referenceListSchema } } } },
  }),
  "admin",
);
const createEntryRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/admin/reference/{kind}",
    summary: "Add an entry",
    request: { params: kindParam, body: looseBody },
    responses: {
      201: { description: "Created", content: { "application/json": { schema: referenceEntrySchema } } },
      400: errorContent("Invalid body, or unknown parent"),
      409: errorContent("slug_taken"),
    },
  }),
  "admin",
);
const patchEntryRoute = defineAccess(
  createRoute({
    method: "patch",
    path: "/admin/reference/{kind}/{id}",
    summary: "Rename, re-key or (categories) move an entry",
    request: { params: entryParams, body: looseBody },
    responses: {
      200: { description: "Updated", content: { "application/json": { schema: referenceEntrySchema } } },
      400: errorContent("Invalid body, unknown parent, or cycle"),
      404: errorContent("Unknown entry"),
      409: errorContent("slug_taken"),
    },
  }),
  "admin",
);
const deleteEntryRoute = defineAccess(
  createRoute({
    method: "delete",
    path: "/admin/reference/{kind}/{id}",
    summary: "Delete an entry; sheets that used it lose it",
    request: { params: entryParams },
    responses: {
      200: { description: "Deleted", content: { "application/json": { schema: referenceDeletedSchema } } },
      404: errorContent("Unknown entry"),
      409: errorContent("has_children: a category with sub-categories"),
    },
  }),
  "admin",
);

function pgCode(error: unknown): { code: string | undefined; constraint: string | undefined } {
  const e = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  return { code: e?.cause?.code ?? e?.code, constraint: e?.cause?.constraint ?? e?.constraint };
}

const tables = {
  categories: schema.categories,
  colors: schema.colors,
  materials: schema.materials,
  patterns: schema.patterns,
} as const;

function shape(kind: ReferenceKind, row: Record<string, unknown>): ReferenceEntry {
  const base = {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    keywords: row.keywords as string[],
  };
  if (kind === "categories") {
    return { ...base, parentId: row.parentId as string | null, position: row.position as number };
  }
  return kind === "colors" ? { ...base, hex: row.hex as string } : base;
}

/** Whether making `parentId` the parent of `id` would loop: `parentId` is `id` or one of its descendants. */
async function createsCycle(db: Pick<Database, "execute">, id: string, parentId: string): Promise<boolean> {
  const { rows } = await db.execute<{ found: boolean }>(sql`
    with recursive up as (
      select id, parent_id from categories where id = ${parentId}::uuid
      union
      select c.id, c.parent_id from categories c join up on c.id = up.parent_id
    )
    select exists (select 1 from up where id = ${id}::uuid) as found`);
  return rows[0]?.found === true;
}

export function adminReferenceRoutes(deps: CatalogDeps) {
  const { db } = deps;
  const app = new OpenAPIHono<AdminEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });

  return app
    .openapi(listRoute, async (c) => {
      const { kind } = c.req.valid("param");
      const table = tables[kind];
      const rows =
        kind === "categories"
          ? await db
              .select()
              .from(schema.categories)
              .orderBy(asc(schema.categories.position), asc(schema.categories.name), asc(schema.categories.id))
          : await db.select().from(table).orderBy(asc(table.name), asc(table.id));
      return c.json({ entries: rows.map((r) => shape(kind, r)) }, 200);
    })
    .openapi(createEntryRoute, async (c) => {
      const { kind } = c.req.valid("param");
      noteAudit(c, { action: "reference.create", target: kind });
      const parsed = referenceCreateSchemas[kind].safeParse(c.req.valid("json"));
      if (!parsed.success) return c.json(invalidRequest, 400);
      try {
        const [row] = await db
          .insert(tables[kind])
          .values(parsed.data as never)
          .returning();
        if (!row) throw new Error("entry not created");
        noteAudit(c, { action: "reference.create", target: `${kind}:${row.id}` });
        return c.json(shape(kind, row), 201);
      } catch (error) {
        const { code, constraint } = pgCode(error);
        if (code === "23505") return c.json({ error: "slug_taken" } as const, 409);
        if (code === "23503" && constraint?.includes("parent")) return c.json(invalidRequest, 400);
        throw error;
      }
    })
    .openapi(patchEntryRoute, async (c) => {
      const { kind, id } = c.req.valid("param");
      noteAudit(c, { action: "reference.update", target: `${kind}:${id}` });
      const parsed = referencePatchSchemas[kind].safeParse(c.req.valid("json"));
      if (!parsed.success) return c.json(invalidRequest, 400);
      const patch = parsed.data as Record<string, unknown>;
      try {
        const outcome = await db.transaction(async (tx) => {
          if (kind === "categories") {
            // One move at a time, so two concurrent moves cannot each look safe and together loop.
            await tx.execute(sql`select pg_advisory_xact_lock(hashtext('categories-tree'))`);
            const parentId = patch.parentId;
            if (typeof parentId === "string" && (parentId === id || (await createsCycle(tx, id, parentId)))) {
              return "cycle" as const;
            }
          }
          const [row] = await tx
            .update(tables[kind])
            .set(patch as never)
            .where(eq(tables[kind].id, id))
            .returning();
          return row ?? ("not_found" as const);
        });
        if (outcome === "cycle") return c.json({ error: "cycle" } as const, 400);
        if (outcome === "not_found") return c.json(notFound, 404);
        return c.json(shape(kind, outcome), 200);
      } catch (error) {
        const { code, constraint } = pgCode(error);
        if (code === "23505") return c.json({ error: "slug_taken" } as const, 409);
        if (code === "23503" && constraint?.includes("parent")) return c.json(invalidRequest, 400);
        throw error;
      }
    })
    .openapi(deleteEntryRoute, async (c) => {
      const { kind, id } = c.req.valid("param");
      noteAudit(c, { action: "reference.delete", target: `${kind}:${id}` });
      try {
        const rows = await db
          .delete(tables[kind])
          .where(and(eq(tables[kind].id, id)))
          .returning({ id: tables[kind].id });
        return rows.length === 0 ? c.json(notFound, 404) : c.json({ deleted: true } as const, 200);
      } catch (error) {
        const { code } = pgCode(error);
        if (code === "23503" || code === "23001") return c.json({ error: "has_children" } as const, 409);
        throw error;
      }
    });
}
