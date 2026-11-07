import { asc, eq, schema } from "@closyria/db";
import type { ItemView, MutationResult, UndoPayload } from "@closyria/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../catalog/test-app";

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

type ItemResult = MutationResult & { item: ItemView };

function call(method: string, path: string, cookie: string, body?: unknown) {
  return t.app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { origin: BASE_URL, "content-type": "application/json", cookie },
  });
}

async function newProduct(priceCents: number | null) {
  const n = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `Boutique S${n}`, slug: `spent-shop-${n}` })
    .returning();
  if (!shop) throw new Error("no shop");
  const [product] = await t.db
    .insert(schema.products)
    .values({ shopId: shop.id, canonicalUrl: `https://spent-${n}.test/p`, name: `Robe ${n}`, priceCents })
    .returning();
  if (!product) throw new Error("no product");
  return product;
}

async function keep(cookie: string, productId: string, action: "wish" | "ordered") {
  const res = await call("POST", "/api/me/items", cookie, { productId, action });
  expect([200, 201]).toContain(res.status);
  return (await res.json()) as ItemResult;
}

const stageTo = (cookie: string, itemId: string, body: Record<string, unknown>) =>
  call("POST", `/api/me/items/${itemId}/stage`, cookie, body);

const spentOf = async (itemId: string, stage: string) =>
  (
    await t.db
      .select()
      .from(schema.itemEvents)
      .where(eq(schema.itemEvents.itemId, itemId))
      .orderBy(asc(schema.itemEvents.createdAt))
  )
    .filter((e) => e.stage === stage)
    .map((e) => e.spentCents);

describe("spent_cents on stage events", () => {
  it("an order records the amount typed, else the shop price, else nothing", async () => {
    const { cookie } = await t.signIn();
    const priced = await newProduct(4990);
    const free = await newProduct(null);
    const a = await keep(cookie, priced.id, "wish");
    const b = await keep(cookie, (await newProduct(4990)).id, "wish");
    const c = await keep(cookie, free.id, "wish");
    const d = await keep(cookie, (await newProduct(1000)).id, "wish");
    const at = "2026-10-20T09:30:00.000Z";
    expect((await stageTo(cookie, a.item.id, { stage: "ordered", at, amountCents: 3500 })).status).toBe(200);
    expect((await stageTo(cookie, b.item.id, { stage: "ordered", at })).status).toBe(200);
    expect((await stageTo(cookie, c.item.id, { stage: "ordered", at })).status).toBe(200);
    expect((await stageTo(cookie, d.item.id, { stage: "ordered", at })).status).toBe(200);
    expect(await spentOf(a.item.id, "ordered")).toEqual([3500]);
    expect(await spentOf(b.item.id, "ordered")).toEqual([4990]);
    expect(await spentOf(c.item.id, "ordered")).toEqual([null]);
    expect(await spentOf(d.item.id, "ordered")).toEqual([1000]);
  });

  it("a return records what its order counted, other stages nothing", async () => {
    const { cookie } = await t.signIn();
    const product = await newProduct(4990);
    const { item } = await keep(cookie, product.id, "wish");
    await stageTo(cookie, item.id, { stage: "ordered", at: "2026-10-20T09:30:00.000Z", amountCents: 3500 });
    await stageTo(cookie, item.id, { stage: "owned", at: "2026-10-21T09:30:00.000Z" });
    await stageTo(cookie, item.id, { stage: "returned", at: "2026-10-22T09:30:00.000Z" });
    expect(await spentOf(item.id, "owned")).toEqual([null]);
    expect(await spentOf(item.id, "returned")).toEqual([3500]);
    const lone = await keep(cookie, (await newProduct(100)).id, "wish");
    await stageTo(cookie, lone.item.id, { stage: "returned", at: "2026-10-22T09:30:00.000Z" });
    expect(await spentOf(lone.item.id, "returned")).toEqual([null]);
  });

  it("a keep with action ordered records the shop price", async () => {
    const { cookie } = await t.signIn();
    const { item } = await keep(cookie, (await newProduct(2590)).id, "ordered");
    expect(await spentOf(item.id, "ordered")).toEqual([2590]);
    const none = await keep(cookie, (await newProduct(null)).id, "ordered");
    expect(await spentOf(none.item.id, "ordered")).toEqual([null]);
  });

  it("the bulk stage op records the amounts, and undo removes the events (nothing counted)", async () => {
    const { cookie } = await t.signIn();
    const x = await keep(cookie, (await newProduct(1200)).id, "wish");
    const y = await keep(cookie, (await newProduct(null)).id, "wish");
    const at = "2026-10-20T09:30:00.000Z";
    const res = await call("POST", "/api/me/items/bulk", cookie, {
      ids: [x.item.id, y.item.id],
      op: "stage",
      stage: "ordered",
      at,
    });
    expect(res.status).toBe(200);
    const done = (await res.json()) as MutationResult;
    expect(await spentOf(x.item.id, "ordered")).toEqual([1200]);
    expect(await spentOf(y.item.id, "ordered")).toEqual([null]);
    const ret = await call("POST", "/api/me/items/bulk", cookie, {
      ids: [x.item.id],
      op: "stage",
      stage: "returned",
      at,
    });
    expect(ret.status).toBe(200);
    expect(await spentOf(x.item.id, "returned")).toEqual([1200]);
    const undone = await call("POST", "/api/me/items/undo", cookie, done.undo as UndoPayload);
    expect(undone.status).toBe(200);
    expect(await spentOf(x.item.id, "ordered")).toEqual([]);
    expect(await spentOf(y.item.id, "ordered")).toEqual([]);
  });
});
