import { eq, schema } from "@closyria/db";
import type { ItemCounts, ItemPage, ItemView, MutationResult } from "@closyria/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let counter = 0;
/** 11 November 2026, 10:00 in Paris (UTC+1). */
const NOW = new Date("2026-11-11T09:00:00.000Z");

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness({ now: () => NOW });
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

async function newProduct() {
  const n = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `Boutique C${n}`, slug: `me-counts-shop-${n}` })
    .returning();
  if (!shop) throw new Error("no shop");
  const [product] = await t.db
    .insert(schema.products)
    .values({ shopId: shop.id, canonicalUrl: `https://me-counts-${n}.test/p`, name: `Robe ${n}` })
    .returning();
  if (!product) throw new Error("no product");
  return product;
}

async function wish(cookie: string, profileId?: string) {
  const product = await newProduct();
  const res = await call("POST", "/api/me/items", cookie, {
    productId: product.id,
    action: "wish",
    ...(profileId ? { profileId } : {}),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as ItemResult).item;
}

async function move(cookie: string, id: string, stage: string, at: string) {
  const res = await call("POST", `/api/me/items/${id}/stage`, cookie, { stage, at });
  expect(res.status).toBe(200);
  return ((await res.json()) as ItemResult).item;
}

async function counts(cookie: string, query = "") {
  const res = await call("GET", `/api/me/items/counts${query}`, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as ItemCounts;
}

async function list(cookie: string, query: string) {
  const res = await call("GET", `/api/me/items?${query}`, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as ItemPage;
}

const ids = (page: ItemPage) => page.items.map((item) => item.id).sort();

describe("GET /api/me/items/counts", () => {
  it("counts her items of each step, without the trash, the sold and the returned ones", async () => {
    const { cookie } = await t.signIn();
    await wish(cookie);
    await wish(cookie);
    const ordered = await wish(cookie);
    await move(cookie, ordered.id, "ordered", "2026-11-10T09:00:00.000Z");
    const received = await wish(cookie);
    await move(cookie, received.id, "owned", "2026-11-01T09:00:00.000Z");
    const kept = await wish(cookie);
    await move(cookie, kept.id, "owned", "2026-09-01T09:00:00.000Z");
    const selling = await wish(cookie);
    await move(cookie, selling.id, "for_sale", "2026-11-01T09:00:00.000Z");
    const sold = await wish(cookie);
    await move(cookie, sold.id, "sold", "2026-11-01T09:00:00.000Z");
    const returned = await wish(cookie);
    await move(cookie, returned.id, "returned", "2026-11-01T09:00:00.000Z");
    const trashed = await wish(cookie);
    expect((await call("DELETE", `/api/me/items/${trashed.id}`, cookie)).status).toBe(200);

    expect(await counts(cookie)).toEqual({ envie: 2, commande: 1, recu: 1, dressing: 1, aVendre: 1 });
  });

  it("counts one profile's items with `profile`, and nothing of another account", async () => {
    const { cookie } = await t.signIn();
    const res = await call("POST", "/api/me/profiles", cookie, { name: "Léa", audience: "women", color: "rose" });
    const lea = (await res.json()) as { id: string };
    await wish(cookie);
    await wish(cookie, lea.id);
    await wish(cookie, lea.id);
    const other = await t.signIn();
    await wish(other.cookie);

    expect(await counts(cookie, `?profile=${lea.id}`)).toEqual({
      envie: 2,
      commande: 0,
      recu: 0,
      dressing: 0,
      aVendre: 0,
    });
    expect((await counts(cookie)).envie).toBe(3);
  });

  it("answers 400 for an invalid profile", async () => {
    const { cookie } = await t.signIn();
    expect((await call("GET", "/api/me/items/counts?profile=nope", cookie)).status).toBe(400);
  });
});

describe("« Reçu » or « Dans mon dressing » (30 Paris days after her last move to « owned »)", () => {
  it("is « Reçu » 29 days after, « Dans mon dressing » 30 and 31 days after, everywhere the same", async () => {
    const { cookie } = await t.signIn();
    // Paris days before 11 November: 13 October is 29 days, 12 October 30, 11 October 31.
    const day29 = await move(cookie, (await wish(cookie)).id, "owned", "2026-10-13T08:00:00.000Z");
    // 00:30 on 13 October in Paris is still 12 October in UTC: 29 Paris days.
    const day29Early = await move(cookie, (await wish(cookie)).id, "owned", "2026-10-12T22:30:00.000Z");
    // 23:30 on 12 October in Paris: 30 Paris days.
    const day30Late = await move(cookie, (await wish(cookie)).id, "owned", "2026-10-12T21:30:00.000Z");
    const day30 = await move(cookie, (await wish(cookie)).id, "owned", "2026-10-12T08:00:00.000Z");
    const day31 = await move(cookie, (await wish(cookie)).id, "owned", "2026-10-11T08:00:00.000Z");

    expect(day29.received).toBe(true);
    expect(day30.received).toBe(false);
    expect(await counts(cookie)).toMatchObject({ recu: 2, dressing: 3 });
    expect(ids(await list(cookie, "stage=owned&received=true"))).toEqual([day29.id, day29Early.id].sort());
    expect(ids(await list(cookie, "stage=owned&received=false"))).toEqual([day30Late.id, day30.id, day31.id].sort());
    const all = await list(cookie, "stage=owned");
    expect(Object.fromEntries(all.items.map((item) => [item.id, item.received]))).toEqual({
      [day29.id]: true,
      [day29Early.id]: true,
      [day30Late.id]: false,
      [day30.id]: false,
      [day31.id]: false,
    });
  });

  it("follows her most recent move to « owned », and an item with none is in her dressing", async () => {
    const { cookie } = await t.signIn();
    const back = await wish(cookie);
    await move(cookie, back.id, "owned", "2026-08-01T08:00:00.000Z");
    await move(cookie, back.id, "for_sale", "2026-09-01T08:00:00.000Z");
    const again = await move(cookie, back.id, "owned", "2026-11-05T08:00:00.000Z");
    const direct = await wish(cookie);
    await t.db.update(schema.items).set({ stage: "owned" }).where(eq(schema.items.id, direct.id));

    expect(again.received).toBe(true);
    expect(await counts(cookie)).toMatchObject({ envie: 0, recu: 1, dressing: 1 });
    expect(ids(await list(cookie, "stage=owned&received=false"))).toEqual([direct.id]);
    const spotted = await wish(cookie);
    expect(spotted.received).toBe(false);
  });
});

describe("GET /api/me/items?stages=", () => {
  it("keeps the items of the given stages only (« Tout »: not the sold or returned ones)", async () => {
    const { cookie } = await t.signIn();
    const spotted = await wish(cookie);
    const owned = await move(cookie, (await wish(cookie)).id, "owned", "2026-11-01T09:00:00.000Z");
    await move(cookie, (await wish(cookie)).id, "sold", "2026-11-01T09:00:00.000Z");

    expect(ids(await list(cookie, "stages=spotted,ordered,owned,for_sale"))).toEqual([spotted.id, owned.id].sort());
    expect((await call("GET", "/api/me/items?stages=spotted,nope", cookie)).status).toBe(400);
  });
});
