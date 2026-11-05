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

  const missing = async (table: typeof schema.colors | typeof schema.materials | typeof schema.patterns) =>
    new Set((await db.select({ slug: table.slug }).from(table)).map((r) => r.slug));

  const knownColors = await missing(schema.colors);
  for (const c of STARTING_REFERENCE.colors) {
    if (knownColors.has(c.slug)) continue;
    const rows = await db
      .insert(schema.colors)
      .values({ slug: c.slug, name: c.name, hex: c.hex, keywords: [...c.keywords] })
      .onConflictDoNothing({ target: schema.colors.slug })
      .returning({ id: schema.colors.id });
    added += rows.length;
  }
  const knownMaterials = await missing(schema.materials);
  for (const m of STARTING_REFERENCE.materials) {
    if (knownMaterials.has(m.slug)) continue;
    const rows = await db
      .insert(schema.materials)
      .values({ slug: m.slug, name: m.name, keywords: [...m.keywords] })
      .onConflictDoNothing({ target: schema.materials.slug })
      .returning({ id: schema.materials.id });
    added += rows.length;
  }
  const knownPatterns = await missing(schema.patterns);
  for (const p of STARTING_REFERENCE.patterns) {
    if (knownPatterns.has(p.slug)) continue;
    const rows = await db
      .insert(schema.patterns)
      .values({ slug: p.slug, name: p.name, keywords: [...p.keywords] })
      .onConflictDoNothing({ target: schema.patterns.slug })
      .returning({ id: schema.patterns.id });
    added += rows.length;
  }
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
