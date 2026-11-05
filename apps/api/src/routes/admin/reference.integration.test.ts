import { eq, schema } from "@closyria/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let adminCookie: string;
let userCookie: string;
let counter = 0;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness();
  const admin = await t.signIn();
  await t.db.update(schema.user).set({ role: "admin", isAnonymous: false }).where(eq(schema.user.id, admin.userId));
  await t.db.update(schema.session).set({ authMethod: "passkey" }).where(eq(schema.session.userId, admin.userId));
  adminCookie = admin.cookie;
  userCookie = (await t.signIn()).cookie;
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

function call(method: string, path: string, body?: unknown, cookie = adminCookie) {
  return t.app.request(`/api/admin/reference${path}`, {
    method,
    headers: {
      origin: BASE_URL,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
// biome-ignore lint/suspicious/noExplicitAny: loose reader of JSON answers in tests
const json = async (res: Response) => (await res.json()) as Record<string, any>;
const slug = (p: string) => `${p}-${++counter}`;

async function createCategory(parentId: string | null = null) {
  const res = await call("POST", "/categories", { slug: slug("cat"), name: "Cat", parentId });
  expect(res.status).toBe(201);
  return (await json(res)) as { id: string; parentId: string | null };
}

describe("admin reference lists", () => {
  it("answers 403 to a non-admin and 401 to nobody on every route", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const routes: [string, string, unknown?][] = [
      ["GET", "/categories"],
      ["POST", "/colors", { slug: "x", name: "x", hex: "#000000" }],
      ["PATCH", `/materials/${id}`, { name: "x" }],
      ["DELETE", `/patterns/${id}`],
    ];
    for (const [method, path, body] of routes) {
      expect((await call(method, path, body, userCookie)).status, `${method} ${path}`).toBe(403);
      expect((await call(method, path, body, "")).status, `${method} ${path}`).toBe(401);
    }
  });

  it("creates, lists, renames and deletes an entry of each kind, journaling every mutation", async () => {
    await t.db.delete(schema.adminAuditLog);
    const bodies = {
      categories: { slug: slug("c"), name: "Robes" },
      colors: { slug: slug("c"), name: "Rouge", hex: "#FF0000" },
      materials: { slug: slug("m"), name: "Lin" },
      patterns: { slug: slug("p"), name: "Rayures" },
    };
    for (const [kind, body] of Object.entries(bodies)) {
      const created = await call("POST", `/${kind}`, { ...body, keywords: ["a"] });
      expect(created.status, kind).toBe(201);
      const entry = await json(created);
      expect(entry).toMatchObject({ slug: body.slug, name: body.name, keywords: ["a"] });
      const list = await json(await call("GET", `/${kind}`));
      expect(list.entries.map((e: { id: string }) => e.id)).toContain(entry.id);
      const patched = await call("PATCH", `/${kind}/${entry.id}`, { name: "Renamed" });
      expect(patched.status).toBe(200);
      expect((await json(patched)).name).toBe("Renamed");
      expect((await call("DELETE", `/${kind}/${entry.id}`)).status).toBe(200);
      expect((await call("DELETE", `/${kind}/${entry.id}`)).status).toBe(404);
      expect((await call("PATCH", `/${kind}/${entry.id}`, { name: "x" })).status).toBe(404);
    }
    const actions = (await t.db.select().from(schema.adminAuditLog)).map((a) => a.action).sort();
    expect(actions).toHaveLength(20);
    expect(actions).toContain("reference.create");
    expect(actions).toContain("reference.update");
    expect(actions).toContain("reference.delete");
  });

  it("rejects bad input and duplicate slugs", async () => {
    expect((await call("POST", "/colors", { slug: "bad-hex", name: "x", hex: "red" })).status).toBe(400);
    expect((await call("POST", "/materials", { slug: "Bad Slug", name: "x" })).status).toBe(400);
    expect((await call("POST", "/materials", { slug: "ok", name: "" })).status).toBe(400);
    const s = slug("dup");
    expect((await call("POST", "/patterns", { slug: s, name: "A" })).status).toBe(201);
    const dup = await call("POST", "/patterns", { slug: s, name: "B" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: "slug_taken" });
    const other = await json(await call("POST", "/patterns", { slug: slug("dup"), name: "C" }));
    const clash = await call("PATCH", `/patterns/${other.id}`, { slug: s });
    expect(clash.status).toBe(409);
    expect(await clash.json()).toEqual({ error: "slug_taken" });
  });

  it("trims keywords, drops case-insensitive duplicates, and enforces the limits", async () => {
    const res = await call("POST", "/materials", {
      slug: slug("kw"),
      name: "Coton",
      keywords: ["  Coton ", "coton", "COTON", "lin"],
    });
    expect((await json(res)).keywords).toEqual(["Coton", "lin"]);
    const base = { slug: slug("kw"), name: "x" };
    expect((await call("POST", "/materials", { ...base, keywords: [""] })).status).toBe(400);
    expect((await call("POST", "/materials", { ...base, keywords: ["a".repeat(61)] })).status).toBe(400);
    const many = Array.from({ length: 101 }, (_, i) => `k${i}`);
    expect((await call("POST", "/materials", { ...base, keywords: many })).status).toBe(400);
    expect((await call("POST", "/materials", { ...base, keywords: many.slice(0, 100) })).status).toBe(201);
  });

  it("refuses a category move that creates a cycle (400 cycle) and allows a valid move", async () => {
    const a = await createCategory();
    const b = await createCategory(a.id);
    const c = await createCategory(b.id);
    for (const parentId of [a.id === c.id ? null : c.id, b.id]) {
      const res = await call("PATCH", `/categories/${a.id}`, { parentId });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "cycle" });
    }
    const self = await call("PATCH", `/categories/${b.id}`, { parentId: b.id });
    expect(self.status).toBe(400);
    expect(await self.json()).toEqual({ error: "cycle" });
    const [row] = await t.db.select().from(schema.categories).where(eq(schema.categories.id, a.id));
    expect(row?.parentId).toBeNull();

    const moved = await call("PATCH", `/categories/${c.id}`, { parentId: a.id });
    expect(moved.status).toBe(200);
    expect((await json(moved)).parentId).toBe(a.id);
    expect((await call("PATCH", `/categories/${c.id}`, { parentId: null })).status).toBe(200);
    expect(
      (await call("PATCH", `/categories/${c.id}`, { parentId: "00000000-0000-4000-8000-0000000000ff" })).status,
    ).toBe(400);
  });

  it("refuses to delete a category with children (409 has_children)", async () => {
    const parent = await createCategory();
    const child = await createCategory(parent.id);
    const res = await call("DELETE", `/categories/${parent.id}`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "has_children" });
    expect((await call("DELETE", `/categories/${child.id}`)).status).toBe(200);
    expect((await call("DELETE", `/categories/${parent.id}`)).status).toBe(200);
  });

  it("deleting an entry used by products clears it on them", async () => {
    const [shop] = await t.db
      .insert(schema.shops)
      .values({ name: "RS", slug: slug("rs") })
      .returning();
    const color = await json(await call("POST", "/colors", { slug: slug("col"), name: "Bleu", hex: "#0000FF" }));
    const [product] = await t.db
      .insert(schema.products)
      .values({ shopId: shop?.id ?? "", canonicalUrl: `https://ref.test/${counter}`, colorId: color.id })
      .returning();
    expect((await call("DELETE", `/colors/${color.id}`)).status).toBe(200);
    const [after] = await t.db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, product?.id ?? ""));
    expect(after?.colorId).toBeNull();
  });
});
