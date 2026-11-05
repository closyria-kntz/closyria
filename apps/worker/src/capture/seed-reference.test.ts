import { createDb, eq, schema } from "@closyria/db";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedReference } from "./seed-reference";
import { STARTING_REFERENCE } from "./starting-reference";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let handle: ReturnType<typeof createDb>;

beforeAll(async () => {
  database = await createTestDatabase();
  handle = createDb(database.url, { max: 2 });
}, 60_000);

afterAll(async () => {
  await handle?.pool.end();
  await database?.stop();
});

describe("STARTING_REFERENCE", () => {
  it("has unique slugs, parents before children, 16 colours", () => {
    const slugs = STARTING_REFERENCE.categories.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const [i, c] of STARTING_REFERENCE.categories.entries()) {
      if (c.parent) expect(slugs.indexOf(c.parent)).toBeGreaterThanOrEqual(0);
      if (c.parent) expect(slugs.indexOf(c.parent)).toBeLessThan(i);
    }
    expect(STARTING_REFERENCE.colors).toHaveLength(16);
    expect(STARTING_REFERENCE.materials).toHaveLength(10);
    expect(STARTING_REFERENCE.patterns).toHaveLength(7);
  });
});

describe("seedReference", () => {
  it("seeds once, adds nothing the second time, and leaves an admin edit intact", async () => {
    const first = await seedReference(handle.db);
    expect(first).toBeGreaterThan(0);
    const [longDress] = await handle.db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.slug, "robe-longue"));
    const [dresses] = await handle.db.select().from(schema.categories).where(eq(schema.categories.slug, "robes"));
    expect(longDress?.parentId).toBe(dresses?.id);

    await handle.db
      .update(schema.categories)
      .set({ name: "Maxi robes", keywords: ["custom"] })
      .where(eq(schema.categories.slug, "robe-longue"));
    await handle.db.delete(schema.patterns).where(eq(schema.patterns.slug, "uni"));

    expect(await seedReference(handle.db)).toBe(1); // only the deleted pattern comes back
    expect(await seedReference(handle.db)).toBe(0);
    const [edited] = await handle.db.select().from(schema.categories).where(eq(schema.categories.slug, "robe-longue"));
    expect(edited).toMatchObject({ name: "Maxi robes", keywords: ["custom"] });
  });
});
