import { eq, schema } from "@closyria/db";
import type { ItemOpinions, WishlistOpinions, WishlistView } from "@closyria/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let counter = 0;
const UNKNOWN_ID = "7b1f6a52-3a0b-4a4c-9f0e-5b1c2d3e4f50";

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness();
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

function call(method: string, path: string, cookie: string | undefined, body?: unknown) {
  return t.app.request(`/api${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

async function createList(cookie: string, name = "Été") {
  const res = await call("POST", "/me/wishlists", cookie, { name });
  expect(res.status).toBe(201);
  return (await res.json()) as WishlistView;
}

async function newItem(cookie: string, userId: string) {
  const k = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `Boutique O${k}`, slug: `me-op-shop-${k}` })
    .returning();
  const [p] = await t.db
    .insert(schema.products)
    .values({ shopId: shop?.id ?? "", canonicalUrl: `https://me-op-${k}.test/p`, name: `Robe ${k}`, currency: "EUR" })
    .returning();
  const profiles = (await (await call("GET", "/me/profiles", cookie)).json()) as { profiles: { id: string }[] };
  const [row] = await t.db
    .insert(schema.items)
    .values({ userId, profileId: profiles.profiles[0]?.id ?? "", productId: p?.id ?? "" })
    .returning();
  if (!row) throw new Error("no item");
  return row;
}

async function setup(shared = true) {
  const { cookie, userId } = await t.signIn();
  const list = await createList(cookie);
  const item = await newItem(cookie, userId);
  expect((await call("POST", `/me/wishlists/${list.id}/items`, cookie, { itemId: item.id })).status).toBe(200);
  if (shared) expect((await call("POST", `/me/wishlists/${list.id}/share`, cookie)).status).toBe(200);
  return { cookie, userId, list, item };
}

async function addOpinion(listId: string, itemId: string, name: string, level = 3, at?: Date) {
  const [row] = await t.db
    .insert(schema.wishlistOpinions)
    .values({
      wishlistId: listId,
      itemId,
      authorName: name,
      authorNameKey: name.toLowerCase(),
      level,
      note: "joli",
      ...(at ? { createdAt: at, updatedAt: at } : {}),
    })
    .returning();
  if (!row) throw new Error("no opinion");
  return row;
}

const listOf = async (cookie: string) =>
  ((await (await call("GET", "/me/wishlists", cookie)).json()) as { wishlists: WishlistView[] }).wishlists;

describe("owner side of the opinions", () => {
  it("changes the settings, alone or with the name, and reads them back", async () => {
    const { cookie, list } = await setup();
    expect(list).toMatchObject({
      allowOpinions: true,
      showOwnerName: true,
      showOwnerOpinions: true,
      showBudget: false,
    });
    const res = await call("PATCH", `/me/wishlists/${list.id}`, cookie, { allowOpinions: false, showBudget: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      name: "Été",
      allowOpinions: false,
      showBudget: true,
      showOwnerName: true,
    });
    const both = await call("PATCH", `/me/wishlists/${list.id}`, cookie, { name: "Hiver", showOwnerName: false });
    expect(await both.json()).toMatchObject({ name: "Hiver", showOwnerName: false, allowOpinions: false });
    expect((await listOf(cookie)).find((w) => w.id === list.id)).toMatchObject({
      name: "Hiver",
      showOwnerName: false,
      showBudget: true,
    });
    expect((await call("PATCH", `/me/wishlists/${list.id}`, cookie, {})).status).toBe(400);
    expect((await call("PATCH", `/me/wishlists/${list.id}`, cookie, { showBudget: "yes" })).status).toBe(400);
  });

  it("counts new opinions, lists them with isNew, and the count falls to 0 after seen", async () => {
    const { cookie, list, item } = await setup();
    await addOpinion(list.id, item.id, "Léa");
    await addOpinion(list.id, item.id, "Zoé");
    expect((await listOf(cookie)).find((w) => w.id === list.id)?.newOpinions).toBe(2);
    const read = (await (await call("GET", `/me/wishlists/${list.id}/opinions`, cookie)).json()) as WishlistOpinions;
    expect(read.items).toHaveLength(1);
    expect(read.items[0]?.itemId).toBe(item.id);
    expect(read.items[0]?.opinions.map((o) => [o.name, o.isNew])).toEqual([
      ["Léa", true],
      ["Zoé", true],
    ]);
    expect((await call("POST", `/me/wishlists/${list.id}/opinions/seen`, cookie)).status).toBe(204);
    expect((await listOf(cookie)).find((w) => w.id === list.id)?.newOpinions).toBe(0);
    const after = (await (await call("GET", `/me/wishlists/${list.id}/opinions`, cookie)).json()) as WishlistOpinions;
    expect(after.items[0]?.opinions.every((o) => !o.isNew)).toBe(true);
    await t.db
      .update(schema.wishlistOpinions)
      .set({ level: 1, updatedAt: new Date(Date.now() - 5000) })
      .where(eq(schema.wishlistOpinions.authorNameKey, "léa"));
    expect((await listOf(cookie)).find((w) => w.id === list.id)?.newOpinions).toBe(0);
    await t.db
      .update(schema.wishlistOpinions)
      .set({ level: 1, updatedAt: new Date(Date.now() + 60_000) })
      .where(eq(schema.wishlistOpinions.authorNameKey, "zoé"));
    expect((await listOf(cookie)).find((w) => w.id === list.id)?.newOpinions).toBe(1);
  });

  it("erases an opinion then restores the same one, refusing to overwrite", async () => {
    const { cookie, list, item } = await setup();
    const row = await addOpinion(list.id, item.id, "Léa", 4, new Date("2026-01-02T03:04:05.678Z"));
    const del = await call("DELETE", `/me/wishlists/${list.id}/opinions/${row.id}`, cookie);
    expect(del.status).toBe(200);
    const { opinion } = (await del.json()) as { opinion: Record<string, unknown> };
    expect(opinion).toMatchObject({ id: row.id, itemId: item.id, name: "Léa", level: 4, note: "joli" });
    expect(await t.db.select().from(schema.wishlistOpinions).where(eq(schema.wishlistOpinions.id, row.id))).toEqual([]);
    expect((await call("DELETE", `/me/wishlists/${list.id}/opinions/${row.id}`, cookie)).status).toBe(404);

    const restore = await call("POST", `/me/wishlists/${list.id}/opinions/restore`, cookie, opinion);
    expect(restore.status).toBe(201);
    const [back] = await t.db.select().from(schema.wishlistOpinions).where(eq(schema.wishlistOpinions.id, row.id));
    expect(back).toMatchObject({ itemId: item.id, authorName: "Léa", level: 4, authorNameKey: "léa" });
    expect(back?.createdAt.toISOString()).toBe("2026-01-02T03:04:05.678Z");
    expect(back?.updatedAt.toISOString()).toBe("2026-01-02T03:04:05.678Z");

    expect((await call("POST", `/me/wishlists/${list.id}/opinions/restore`, cookie, opinion)).status).toBe(409);
    await call("DELETE", `/me/wishlists/${list.id}/opinions/${row.id}`, cookie);
    await addOpinion(list.id, item.id, "LÉA", 1);
    expect((await call("POST", `/me/wishlists/${list.id}/opinions/restore`, cookie, opinion)).status).toBe(409);
    await call("DELETE", `/me/wishlists/${list.id}/items/${item.id}`, cookie);
    expect((await call("POST", `/me/wishlists/${list.id}/opinions/restore`, cookie, opinion)).status).toBe(404);
    expect(
      (await call("POST", `/me/wishlists/${list.id}/opinions/restore`, cookie, { ...opinion, level: 9 })).status,
    ).toBe(400);
  });

  it("restores even once the share stopped, never a note with a web address", async () => {
    const { cookie, list, item } = await setup();
    const row = await addOpinion(list.id, item.id, "Léa", 4);
    const del = await call("DELETE", `/me/wishlists/${list.id}/opinions/${row.id}`, cookie);
    const { opinion } = (await del.json()) as { opinion: Record<string, unknown> };
    const restore = (body: unknown) => call("POST", `/me/wishlists/${list.id}/opinions/restore`, cookie, body);
    const linked = await restore({ ...opinion, note: "regarde zara.com" });
    expect(linked.status).toBe(422);
    expect(await linked.json()).toEqual({ error: "web_address" });
    expect((await restore({ ...opinion, name: "www.lea.fr" })).status).toBe(422);

    expect((await call("DELETE", `/me/wishlists/${list.id}/share`, cookie)).status).toBe(204);
    expect((await restore(opinion)).status).toBe(201);
    expect(
      await t.db.select().from(schema.wishlistOpinions).where(eq(schema.wishlistOpinions.id, row.id)),
    ).toHaveLength(1);
  });

  it("lists the opinions of an item across all her lists, shared or no longer, by list name", async () => {
    const { cookie, userId, list, item } = await setup();
    const zeta = await createList(cookie, "Zèbre");
    const alpha = await createList(cookie, "Alpha");
    const notShared = await createList(cookie, "Privée");
    const empty = await createList(cookie, "Vide");
    for (const l of [zeta, alpha, notShared, empty])
      await call("POST", `/me/wishlists/${l.id}/items`, cookie, { itemId: item.id });
    for (const l of [zeta, alpha, empty]) await call("POST", `/me/wishlists/${l.id}/share`, cookie);
    await addOpinion(list.id, item.id, "Léa");
    await addOpinion(zeta.id, item.id, "Zoé");
    await addOpinion(alpha.id, item.id, "Ana");
    await addOpinion(notShared.id, item.id, "Fantôme");
    const res = await call("GET", `/me/items/${item.id}/opinions`, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ItemOpinions;
    expect(body.lists.map((l) => [l.wishlistName, l.opinions.map((o) => o.name)])).toEqual([
      ["Alpha", ["Ana"]],
      ["Été", ["Léa"]],
      ["Privée", ["Fantôme"]],
      ["Zèbre", ["Zoé"]],
    ]);
    expect(userId).toBeTruthy();
  });

  it("answers 404 for another account's list or item, and 401 without a session", async () => {
    const { list, item, cookie } = await setup();
    const row = await addOpinion(list.id, item.id, "Léa");
    const other = await t.signIn();
    const paths: [string, string, unknown?][] = [
      ["GET", `/me/wishlists/${list.id}/opinions`],
      ["POST", `/me/wishlists/${list.id}/opinions/seen`],
      ["DELETE", `/me/wishlists/${list.id}/opinions/${row.id}`],
      [
        "POST",
        `/me/wishlists/${list.id}/opinions/restore`,
        {
          ...row,
          itemId: item.id,
          name: "Léa",
          isNew: false,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        },
      ],
      ["GET", `/me/items/${item.id}/opinions`],
      ["PATCH", `/me/wishlists/${list.id}`, { allowOpinions: false }],
    ];
    for (const [method, path, body] of paths) {
      expect((await call(method, path, other.cookie, body)).status, `${method} ${path}`).toBe(404);
      expect((await call(method, path, undefined, body)).status, `${method} ${path}`).toBe(401);
    }
    expect((await call("GET", `/me/wishlists/${UNKNOWN_ID}/opinions`, cookie)).status).toBe(404);
    expect((await call("GET", `/me/items/${UNKNOWN_ID}/opinions`, cookie)).status).toBe(404);
    expect(
      await t.db.select().from(schema.wishlistOpinions).where(eq(schema.wishlistOpinions.id, row.id)),
    ).toHaveLength(1);
  });

  it("moves the changes stamp after a friend's opinion and after a settings change", async () => {
    const { cookie, list, item } = await setup();
    const stamp = async () => ((await (await call("GET", "/me/changes", cookie)).json()) as { stamp: string }).stamp;
    const s0 = await stamp();
    const row = await addOpinion(list.id, item.id, "Léa");
    const s1 = await stamp();
    expect(s1).not.toBe(s0);
    await call("PATCH", `/me/wishlists/${list.id}`, cookie, { showBudget: true });
    const s2 = await stamp();
    expect(s2).not.toBe(s1);
    await call("POST", `/me/wishlists/${list.id}/opinions/seen`, cookie);
    const s3 = await stamp();
    expect(s3).not.toBe(s2);
    await call("DELETE", `/me/wishlists/${list.id}/opinions/${row.id}`, cookie);
    expect(await stamp()).not.toBe(s3);
  });
});
