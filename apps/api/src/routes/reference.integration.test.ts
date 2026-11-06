import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../catalog/test-app";

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness();
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

describe("GET /api/reference", () => {
  it("is public, cacheable for an hour, and lists categories and colours", async () => {
    const [parent] = await t.db
      .insert(t.schema.categories)
      .values({ slug: "ref-parent", name: "Robes", position: 2 })
      .returning();
    if (!parent) throw new Error("no category");
    await t.db
      .insert(t.schema.categories)
      .values({ slug: "ref-child", name: "Robes longues", parentId: parent.id, position: 1 });
    await t.db.insert(t.schema.colors).values({ slug: "ref-rose", name: "Rose poudré", hex: "#E8B4B8" });

    const res = await t.app.request("/api/reference", { headers: { origin: BASE_URL } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const body = (await res.json()) as {
      categories: { id: string; parentId: string | null; name: string; position: number }[];
      colors: { id: string; name: string; hex: string }[];
    };
    expect(body.categories).toContainEqual({ id: parent.id, parentId: null, name: "Robes", position: 2 });
    expect(body.categories.find((c) => c.name === "Robes longues")).toMatchObject({ parentId: parent.id });
    expect(body.colors).toContainEqual({ id: expect.any(String), name: "Rose poudré", hex: "#E8B4B8" });
  });
});
