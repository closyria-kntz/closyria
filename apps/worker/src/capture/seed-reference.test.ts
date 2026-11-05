import { createDb, eq, schema } from "@closyria/db";
import { classify } from "@closyria/shared";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadReferenceSet, seedReference } from "./seed-reference";
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

describe("starting keywords", () => {
  const all = STARTING_REFERENCE.categories.flatMap((c) => c.keywords);
  it("has no ambiguous single words", () => {
    for (const word of ["bas", "top", "short", "cap", "tee", "ring", "talon", "pump", "tennis", "flats"]) {
      expect(all).not.toContain(word);
    }
  });
  it("keeps the useful ones", () => {
    for (const word of ["tops", "shorts", "casquette", "escarpins", "robe"]) expect(all).toContain(word);
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

describe("classification with the starting lists", () => {
  it("does not misfile on ambiguous everyday words", async () => {
    await seedReference(handle.db);
    const ref = await loadReferenceSet(handle.db);
    const slugOf = async (name: string) => {
      const id = classify({ name, url: "https://shop.test/p", shopData: {} }, ref).categoryId;
      const [row] = await handle.db
        .select()
        .from(schema.categories)
        .where(eq(schema.categories.id, id ?? ""));
      return row?.slug;
    };
    expect(await slugOf("Escarpins à talons bas")).toBe("escarpins");
    expect(await slugOf("Robe short sleeve")).toBe("robes");
    expect(await slugOf("Casquette Cap Ferret")).toBe("chapeaux-bonnets");
  });
});
