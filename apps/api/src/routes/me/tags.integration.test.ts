import { asc, eq, schema } from "@closyria/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
const UNKNOWN_ID = "7b1f6a52-3a0b-4a4c-9f0e-5b1c2d3e4f50";

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness();
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

type TagJson = { id: string; name: string; color: string | null };

function call(method: string, path: string, cookie: string | undefined, body?: unknown) {
  return t.app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

async function create(cookie: string, body: unknown) {
  const res = await call("POST", "/api/me/tags", cookie, body);
  expect(res.status).toBe(201);
  return (await res.json()) as TagJson;
}

describe("/api/me/tags", () => {
  it("answers 401 without a session", async () => {
    expect((await call("GET", "/api/me/tags", undefined)).status).toBe(401);
  });

  it("creates, lists by name, renames and recolours her tags", async () => {
    const { cookie } = await t.signIn();
    const vinted = await create(cookie, { name: "  Vinted ", color: "sage" });
    expect(vinted).toEqual({ id: expect.any(String), name: "Vinted", color: "sage" });
    const ete = await create(cookie, { name: "été" });
    expect(ete.color).toBeNull();
    const list = await call("GET", "/api/me/tags", cookie);
    expect(list.status).toBe(200);
    expect(((await list.json()) as { tags: TagJson[] }).tags.map((tag) => tag.name)).toEqual(["été", "Vinted"]);

    const renamed = await call("PATCH", `/api/me/tags/${vinted.id}`, cookie, { name: "Vinted 2026", color: null });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toEqual({ id: vinted.id, name: "Vinted 2026", color: null });
    // Changing only the case of her own tag's name is allowed.
    const recased = await call("PATCH", `/api/me/tags/${ete.id}`, cookie, { name: "Été" });
    expect(recased.status).toBe(200);
  });

  it("refuses a duplicate name, case ignored, with 409 tag_exists", async () => {
    const { cookie } = await t.signIn();
    const other = await t.signIn();
    await create(cookie, { name: "Vinted" });
    const dup = await call("POST", "/api/me/tags", cookie, { name: "vinted" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: "tag_exists" });
    const second = await create(cookie, { name: "Leboncoin" });
    const renamed = await call("PATCH", `/api/me/tags/${second.id}`, cookie, { name: "VINTED" });
    expect(renamed.status).toBe(409);
    expect(await renamed.json()).toEqual({ error: "tag_exists" });
    // Another account may use the same name.
    await create(other.cookie, { name: "Vinted" });
  });

  it("caps her tags at 200: the 201st answers 409 tag_limit, even when two are created at once", async () => {
    const { cookie, userId } = await t.signIn();
    await t.db.insert(schema.tags).values(Array.from({ length: 199 }, (_, i) => ({ userId, name: `Tag ${i}` })));
    const [a, b] = await Promise.all([
      call("POST", "/api/me/tags", cookie, { name: "Dernière A" }),
      call("POST", "/api/me/tags", cookie, { name: "Dernière B" }),
    ]);
    expect([a?.status, b?.status].toSorted()).toEqual([201, 409]);
    const refused = a?.status === 409 ? a : b;
    expect(await refused?.json()).toEqual({ error: "tag_limit" });
    const over = await call("POST", "/api/me/tags", cookie, { name: "Encore" });
    expect(over.status).toBe(409);
    expect(await over.json()).toEqual({ error: "tag_limit" });
    expect(await t.db.select().from(schema.tags).where(eq(schema.tags.userId, userId))).toHaveLength(200);
    // Another account is not concerned.
    const other = await t.signIn();
    expect((await call("POST", "/api/me/tags", other.cookie, { name: "Encore" })).status).toBe(201);
  });

  it("refuses an invalid name with 400", async () => {
    const { cookie } = await t.signIn();
    for (const name of ["", "   ", "x".repeat(41)]) {
      expect((await call("POST", "/api/me/tags", cookie, { name })).status).toBe(400);
    }
    expect((await call("POST", "/api/me/tags", cookie, { name: "ok", color: "#ff0000" })).status).toBe(400);
  });

  it("deleting a tag takes it off her items, which stay", async () => {
    const { cookie, userId } = await t.signIn();
    const tag = await create(cookie, { name: "Été" });
    const keep = await create(cookie, { name: "Hiver" });
    const [shop] = await t.db.insert(schema.shops).values({ name: "Boutique T", slug: "me-tags-shop" }).returning();
    const [product] = await t.db
      .insert(schema.products)
      .values({ shopId: shop?.id ?? "", canonicalUrl: "https://me-tags.test/p", name: "Robe" })
      .returning();
    const res = await call("POST", "/api/me/items", cookie, { productId: product?.id, action: "favorite" });
    const { item } = (await res.json()) as { item: { id: string } };
    await t.db.insert(schema.itemTags).values([
      { itemId: item.id, tagId: tag.id },
      { itemId: item.id, tagId: keep.id },
    ]);
    const deleted = await call("DELETE", `/api/me/tags/${tag.id}`, cookie);
    expect(deleted.status).toBe(204);
    const rows = await t.db
      .select()
      .from(schema.itemTags)
      .where(eq(schema.itemTags.itemId, item.id))
      .orderBy(asc(schema.itemTags.tagId));
    expect(rows.map((r) => r.tagId)).toEqual([keep.id]);
    const [row] = await t.db.select().from(schema.items).where(eq(schema.items.id, item.id));
    expect(row?.userId).toBe(userId);
    expect((await call("DELETE", `/api/me/tags/${tag.id}`, cookie)).status).toBe(404);
  });

  it("answers 404 for another user's tag and never lists it", async () => {
    const owner = await t.signIn();
    const other = await t.signIn();
    const tag = await create(owner.cookie, { name: "Secret" });
    for (const [method, path, body] of [
      ["PATCH", `/api/me/tags/${tag.id}`, { name: "Volé" }],
      ["DELETE", `/api/me/tags/${tag.id}`],
      ["PATCH", `/api/me/tags/${UNKNOWN_ID}`, { name: "Volé" }],
      ["DELETE", `/api/me/tags/${UNKNOWN_ID}`],
    ] as [string, string, unknown?][]) {
      const res = await call(method, path, other.cookie, body);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
    expect(((await (await call("GET", "/api/me/tags", other.cookie)).json()) as { tags: TagJson[] }).tags).toEqual([]);
    const [row] = await t.db.select().from(schema.tags).where(eq(schema.tags.id, tag.id));
    expect(row?.name).toBe("Secret");
  });
});
