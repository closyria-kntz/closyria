import { eq, schema } from "@closyria/db";
import type { BudgetView, ItemView, MutationResult, ProfileList, WishlistView } from "@closyria/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let counter = 0;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness();
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

function call(method: string, path: string, cookie: string | undefined, body?: unknown) {
  return t.app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

async function newProduct(priceCents: number | null) {
  const n = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `Boutique O${n}`, slug: `order-draft-shop-${n}` })
    .returning();
  if (!shop) throw new Error("no shop");
  const [product] = await t.db
    .insert(schema.products)
    .values({ shopId: shop.id, canonicalUrl: `https://order-draft-${n}.test/p`, name: `Robe ${n}`, priceCents })
    .returning();
  if (!product) throw new Error("no product");
  return product;
}

async function moiOf(cookie: string): Promise<string> {
  const { profiles } = (await (await call("GET", "/api/me/profiles", cookie)).json()) as ProfileList;
  const moi = profiles[0];
  if (!moi) throw new Error("no profile");
  return moi.id;
}

async function newProfile(cookie: string, name = "Léa"): Promise<string> {
  const res = await call("POST", "/api/me/profiles", cookie, { name, audience: "women", color: "plum" });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function newList(cookie: string, name = "Noël"): Promise<string> {
  const res = await call("POST", "/api/me/wishlists", cookie, { name });
  expect(res.status).toBe(201);
  return ((await res.json()) as WishlistView).id;
}

/** A wish of « Moi » at that shop price, selected for the order unless told otherwise. */
async function wish(cookie: string, priceCents: number | null = 5000, selected = true): Promise<string> {
  const product = await newProduct(priceCents);
  const res = await call("POST", "/api/me/items", cookie, { productId: product.id, action: "wish" });
  expect(res.status).toBe(201);
  const { item } = (await res.json()) as { item: ItemView };
  if (selected) {
    expect((await call("PATCH", `/api/me/items/${item.id}`, cookie, { inOrderDraft: true })).status).toBe(200);
  }
  return item.id;
}

async function item(cookie: string, id: string): Promise<ItemView> {
  const res = await call("GET", `/api/me/items/${id}`, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as ItemView;
}

async function undo(cookie: string, result: MutationResult) {
  expect(result.undo).not.toBeNull();
  const res = await call("POST", "/api/me/items/undo", cookie, result.undo);
  expect(res.status).toBe(200);
}

async function spent(cookie: string, path: string): Promise<number> {
  const res = await call("GET", `${path}/budget`, cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as BudgetView).current?.spentCents ?? Number.NaN;
}

const weekly = { amountCents: 30000, period: "week" } as const;
const ordered = (cookie: string, body: unknown) => call("POST", "/api/me/order-draft/ordered", cookie, body);

describe("POST /api/me/order-draft/ordered", () => {
  it("answers 401 without a session", async () => {
    const { cookie } = await t.signIn();
    const res = await call("POST", "/api/me/order-draft/ordered", undefined, { profileId: await moiOf(cookie) });
    expect(res.status).toBe(401);
  });

  it("orders the profile's selection in one go, counts it in the budget, and the undo puts everything back", async () => {
    const { cookie } = await t.signIn();
    const moi = await moiOf(cookie);
    expect((await call("PUT", `/api/me/profiles/${moi}/budget`, cookie, weekly)).status).toBe(200);
    const robe = await wish(cookie, 8900);
    const jupe = await wish(cookie, 6500);
    const notSelected = await wish(cookie, 4000, false);

    const res = await ordered(cookie, { profileId: moi });
    expect(res.status).toBe(200);
    const result = (await res.json()) as MutationResult;
    expect([...result.itemIds].sort()).toEqual([robe, jupe].sort());
    for (const id of [robe, jupe]) {
      expect(await item(cookie, id)).toMatchObject({ stage: "ordered", inOrderDraft: false });
    }
    expect(await item(cookie, notSelected)).toMatchObject({ stage: "spotted", inOrderDraft: false });
    expect(await spent(cookie, `/api/me/profiles/${moi}`)).toBe(15400);
    expect(result.undo?.removeEventIds).toHaveLength(2);

    await undo(cookie, result);
    for (const id of [robe, jupe]) {
      expect(await item(cookie, id)).toMatchObject({ stage: "spotted", inOrderDraft: true });
    }
    expect(await spent(cookie, `/api/me/profiles/${moi}`)).toBe(0);
  });

  it("answers 409 order_draft_empty when nothing is selected, and leaves the rest alone", async () => {
    const { cookie } = await t.signIn();
    const moi = await moiOf(cookie);
    const other = await wish(cookie, 5000, false);
    const res = await ordered(cookie, { profileId: moi });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "order_draft_empty" });
    expect(await item(cookie, other)).toMatchObject({ stage: "spotted" });
  });

  it("takes only the selected wishes still « Repéré », active, of that profile", async () => {
    const { cookie } = await t.signIn();
    const moi = await moiOf(cookie);
    const lea = await newProfile(cookie);
    const mine = await wish(cookie, 5000);
    const leas = await wish(cookie, 5000);
    expect((await call("POST", `/api/me/items/${leas}/move`, cookie, { profileId: lea })).status).toBe(200);
    expect((await call("PATCH", `/api/me/items/${leas}`, cookie, { inOrderDraft: true })).status).toBe(200);

    const res = await ordered(cookie, { profileId: moi });
    expect(res.status).toBe(200);
    expect(((await res.json()) as MutationResult).itemIds).toEqual([mine]);
    expect(await item(cookie, leas)).toMatchObject({ stage: "spotted", inOrderDraft: true });
  });

  it("from a list, takes only the list's selected items and counts them in the list's budget", async () => {
    const { cookie } = await t.signIn();
    const noel = await newList(cookie);
    expect((await call("PUT", `/api/me/wishlists/${noel}/budget`, cookie, weekly)).status).toBe(200);
    const inList = await wish(cookie, 8900);
    const outside = await wish(cookie, 6500);
    expect((await call("POST", `/api/me/wishlists/${noel}/items`, cookie, { itemId: inList })).status).toBe(200);

    const res = await ordered(cookie, { wishlistId: noel });
    expect(res.status).toBe(200);
    expect(((await res.json()) as MutationResult).itemIds).toEqual([inList]);
    expect(await item(cookie, inList)).toMatchObject({ stage: "ordered", inOrderDraft: false });
    expect(await item(cookie, outside)).toMatchObject({ stage: "spotted", inOrderDraft: true });
    expect(await spent(cookie, `/api/me/wishlists/${noel}`)).toBe(8900);
  });

  it("answers 404 for another account's profile or list, and 400 for a body without scope", async () => {
    const { cookie } = await t.signIn();
    const other = await t.signIn();
    const theirs = await moiOf(other.cookie);
    const theirList = await newList(other.cookie);
    await wish(other.cookie, 5000);
    expect((await ordered(cookie, { profileId: theirs })).status).toBe(404);
    expect((await ordered(cookie, { wishlistId: theirList })).status).toBe(404);
    expect((await ordered(cookie, {})).status).toBe(400);
  });
});

describe("leaving « Repéré », the trash or another profile empties the selection (spec §3.6)", () => {
  it("a single stage change clears it; its undo selects it again", async () => {
    const { cookie } = await t.signIn();
    const id = await wish(cookie);
    const res = await call("POST", `/api/me/items/${id}/stage`, cookie, {
      stage: "owned",
      at: new Date().toISOString(),
    });
    expect(res.status).toBe(200);
    expect(await item(cookie, id)).toMatchObject({ stage: "owned", inOrderDraft: false });
    await undo(cookie, (await res.json()) as MutationResult);
    expect(await item(cookie, id)).toMatchObject({ stage: "spotted", inOrderDraft: true });
  });

  it("a single trash clears it; its undo selects it again", async () => {
    const { cookie } = await t.signIn();
    const id = await wish(cookie);
    const res = await call("DELETE", `/api/me/items/${id}`, cookie);
    expect(res.status).toBe(200);
    const [row] = await t.db.select().from(schema.items).where(eqId(id));
    expect(row?.inOrderDraft).toBe(false);
    await undo(cookie, (await res.json()) as MutationResult);
    expect(await item(cookie, id)).toMatchObject({ inOrderDraft: true });
  });

  it("a single move to another profile clears it; its undo selects it again", async () => {
    const { cookie } = await t.signIn();
    const lea = await newProfile(cookie);
    const id = await wish(cookie);
    const res = await call("POST", `/api/me/items/${id}/move`, cookie, { profileId: lea });
    expect(res.status).toBe(200);
    expect(await item(cookie, id)).toMatchObject({ profileId: lea, inOrderDraft: false });
    await undo(cookie, (await res.json()) as MutationResult);
    expect(await item(cookie, id)).toMatchObject({ inOrderDraft: true });
  });

  it("bulk stage, delete and move clear it; their undo selects it again", async () => {
    const { cookie } = await t.signIn();
    const lea = await newProfile(cookie);
    const ops = [
      { op: "stage", stage: "owned", at: new Date().toISOString() },
      { op: "delete" },
      { op: "move", profileId: lea },
    ];
    for (const op of ops) {
      const selected = await wish(cookie);
      const plain = await wish(cookie, 5000, false);
      const res = await call("POST", "/api/me/items/bulk", cookie, { ids: [selected, plain], ...op });
      expect(res.status, op.op).toBe(200);
      const [row] = await t.db.select().from(schema.items).where(eqId(selected));
      expect(row?.inOrderDraft, op.op).toBe(false);
      await undo(cookie, (await res.json()) as MutationResult);
      expect(await item(cookie, selected), op.op).toMatchObject({ stage: "spotted", inOrderDraft: true });
      expect(await item(cookie, plain), op.op).toMatchObject({ stage: "spotted", inOrderDraft: false });
    }
  });

  it("a bulk stage back to « Repéré » keeps the selection", async () => {
    const { cookie } = await t.signIn();
    const id = await wish(cookie);
    const res = await call("POST", "/api/me/items/bulk", cookie, {
      ids: [id],
      op: "stage",
      stage: "spotted",
      at: new Date().toISOString(),
    });
    expect(res.status).toBe(200);
    expect(await item(cookie, id)).toMatchObject({ inOrderDraft: true });
  });

  it("the undo of a trash still works when the same product was kept again meanwhile (merge)", async () => {
    const { cookie } = await t.signIn();
    const product = await newProduct(5000);
    const created = await call("POST", "/api/me/items", cookie, { productId: product.id, action: "wish" });
    const { item: first } = (await created.json()) as { item: ItemView };
    expect((await call("PATCH", `/api/me/items/${first.id}`, cookie, { inOrderDraft: true })).status).toBe(200);
    const trashed = await call("POST", "/api/me/items/bulk", cookie, { ids: [first.id], op: "delete" });
    expect(trashed.status).toBe(200);
    const again = await call("POST", "/api/me/items", cookie, { productId: product.id, action: "wish" });
    const { item: second } = (await again.json()) as { item: ItemView };
    const res = await call("POST", "/api/me/items/undo", cookie, ((await trashed.json()) as MutationResult).undo);
    expect(res.status).toBe(200);
    expect(await item(cookie, second.id)).toMatchObject({ stage: "spotted" });
  });
});

function eqId(id: string) {
  return eq(schema.items.id, id);
}
