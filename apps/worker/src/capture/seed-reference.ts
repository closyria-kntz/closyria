import { type Database, schema } from "@closyria/db";
import { STARTING_REFERENCE } from "./starting-reference";

/**
 * Inserts the starting reference entries that do not exist yet (by slug). An existing entry is never modified
 * (an admin may have renamed it or edited its keywords). Returns how many were added.
 */
export async function seedReference(db: Database): Promise<number> {
  let added = 0;

  const known = new Map<string, string>(
    (await db.select({ slug: schema.categories.slug, id: schema.categories.id }).from(schema.categories)).map((c) => [
      c.slug,
      c.id,
    ]),
  );
  for (const [position, category] of STARTING_REFERENCE.categories.entries()) {
    if (known.has(category.slug)) continue;
    const parentId = category.parent ? known.get(category.parent) : undefined;
    if (category.parent && !parentId) {
      console.warn(`seed: parent ${category.parent} of category ${category.slug} is missing, skipped`);
      continue;
    }
    const [row] = await db
      .insert(schema.categories)
      .values({
        slug: category.slug,
        name: category.name,
        parentId: parentId ?? null,
        position,
        keywords: [...category.keywords],
      })
      .onConflictDoNothing({ target: schema.categories.slug })
      .returning({ id: schema.categories.id });
    if (!row) continue; // inserted concurrently by another worker
    known.set(category.slug, row.id);
    added += 1;
  }

  const insertMissing = async <T extends { slug: string }>(
    table: typeof schema.colors | typeof schema.materials | typeof schema.patterns,
    entries: readonly T[],
    toRow: (entry: T) => Record<string, unknown>,
  ) => {
    const existing = new Set((await db.select({ slug: table.slug }).from(table)).map((r) => r.slug));
    for (const entry of entries) {
      if (existing.has(entry.slug)) continue;
      const rows = await db
        .insert(table)
        .values(toRow(entry) as never)
        .onConflictDoNothing({ target: table.slug })
        .returning({ id: table.id });
      added += rows.length;
    }
  };
  await insertMissing(schema.colors, STARTING_REFERENCE.colors, (c) => ({ ...c, keywords: [...c.keywords] }));
  await insertMissing(schema.materials, STARTING_REFERENCE.materials, (m) => ({ ...m, keywords: [...m.keywords] }));
  await insertMissing(schema.patterns, STARTING_REFERENCE.patterns, (p) => ({ ...p, keywords: [...p.keywords] }));
  return added;
}

/** The reference lists as `classify` wants them. Small tables: loaded whole, once per capture. */
export async function loadReferenceSet(db: Pick<Database, "select">) {
  const [categories, colors, materials, patterns] = await Promise.all([
    db
      .select({ id: schema.categories.id, parentId: schema.categories.parentId, keywords: schema.categories.keywords })
      .from(schema.categories)
      .orderBy(schema.categories.position),
    db.select({ id: schema.colors.id, keywords: schema.colors.keywords }).from(schema.colors),
    db.select({ id: schema.materials.id, keywords: schema.materials.keywords }).from(schema.materials),
    db.select({ id: schema.patterns.id, keywords: schema.patterns.keywords }).from(schema.patterns),
  ]);
  return { categories, colors, materials, patterns };
}
