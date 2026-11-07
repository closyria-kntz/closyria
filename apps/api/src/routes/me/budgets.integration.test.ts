import { eq, schema } from "@closyria/db";
import type { BudgetHistory, BudgetView, ItemView, ProfileList, WishlistView } from "@closyria/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";
import { periodAt } from "../../wardrobe/budgets";

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

// The real clock: "this week" is the current Paris week, "last week" the day before it began.
const weekOf = (instant: Date) => {
  const week = periodAt({ period: "week", startsOn: null, endsOn: null, resetAt: null, createdAt: instant }, instant);
  if (!week) throw new Error("no week");
  return week;
};
const thisWeek = () => weekOf(new Date());
const thisWeekAt = () => thisWeek().start.toISOString();
const lastWeekAt = () => new Date(thisWeek().start.getTime() - 24 * 60 * 60 * 1000).toISOString();

async function newProduct(priceCents: number | null = 5000) {
  const n = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `Boutique B${n}`, slug: `budget-shop-${n}` })
    .returning();
  if (!shop) throw new Error("no shop");
  const [product] = await t.db
    .insert(schema.products)
    .values({ shopId: shop.id, canonicalUrl: `https://budget-${n}.test/p`, name: `Robe ${n}`, priceCents })
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

async function newList(cookie: string, name = "Noël"): Promise<string> {
  const res = await call("POST", "/api/me/wishlists", cookie, { name });
  expect(res.status).toBe(201);
  return ((await res.json()) as WishlistView).id;
}

/** A wish of « Moi », optionally put in a list. */
async function wish(cookie: string, wishlistId?: string): Promise<string> {
  const product = await newProduct();
  const res = await call("POST", "/api/me/items", cookie, { productId: product.id, action: "wish" });
  expect([200, 201]).toContain(res.status);
  const { item } = (await res.json()) as { item: ItemView };
  if (wishlistId) {
    expect((await call("POST", `/api/me/wishlists/${wishlistId}/items`, cookie, { itemId: item.id })).status).toBe(200);
  }
  return item.id;
}

async function stage(cookie: string, itemId: string, body: { stage: string; at: string; amountCents?: number }) {
  expect((await call("POST", `/api/me/items/${itemId}/stage`, cookie, body)).status).toBe(200);
}

const weekly = { amountCents: 15000, period: "week" } as const;

describe("/api/me/{profiles,wishlists}/{id}/budget", () => {
  it("answers 401 without a session", async () => {
    const { cookie } = await t.signIn();
    const moi = await moiOf(cookie);
    expect((await call("GET", `/api/me/profiles/${moi}/budget`, undefined)).status).toBe(401);
  });

  it("a weekly profile budget deducts this week's orders and credits this week's returns", async () => {
    const { cookie } = await t.signIn();
    const moi = await moiOf(cookie);
    expect((await call("GET", `/api/me/profiles/${moi}/budget`, cookie)).status).toBe(404);
    const lastWeek = await wish(cookie);
    const now = await wish(cookie);
    await stage(cookie, lastWeek, { stage: "ordered", at: lastWeekAt(), amountCents: 3000 });
    await stage(cookie, now, { stage: "ordered", at: thisWeekAt(), amountCents: 8900 });

    const put = await call("PUT", `/api/me/profiles/${moi}/budget`, cookie, weekly);
    expect(put.status).toBe(200);
    const view = (await put.json()) as BudgetView;
    expect(view).toEqual({
      amountCents: 15000,
      period: "week",
      startsOn: null,
      endsOn: null,
      current: {
        start: thisWeek().start.toISOString(),
        end: thisWeek().end.toISOString(),
        spentCents: 8900,
        remainingCents: 6100,
      },
      ended: false,
    });
    expect(await (await call("GET", `/api/me/profiles/${moi}/budget`, cookie)).json()).toEqual(view);

    // Sent back this week, ordered last week: credited this week.
    await stage(cookie, lastWeek, { stage: "returned", at: thisWeekAt() });
    const after = (await (await call("GET", `/api/me/profiles/${moi}/budget`, cookie)).json()) as BudgetView;
    expect(after.current).toMatchObject({ spentCents: 5900, remainingCents: 9100 });
  });

  it("an ordered item put back in the wishes is credited; an owned one put back changes nothing", async () => {
    const { cookie } = await t.signIn();
    const moi = await moiOf(cookie);
    const ordered = await wish(cookie);
    const owned = await wish(cookie);
    await stage(cookie, ordered, { stage: "ordered", at: thisWeekAt(), amountCents: 8900 });
    await stage(cookie, owned, { stage: "ordered", at: thisWeekAt(), amountCents: 2000 });
    await stage(cookie, owned, { stage: "owned", at: thisWeekAt() });
    expect((await call("PUT", `/api/me/profiles/${moi}/budget`, cookie, weekly)).status).toBe(200);
    const spent = async () =>
      ((await (await call("GET", `/api/me/profiles/${moi}/budget`, cookie)).json()) as BudgetView).current?.spentCents;
    expect(await spent()).toBe(10900);
    await stage(cookie, owned, { stage: "spotted", at: thisWeekAt() });
    expect(await spent()).toBe(10900);
    await stage(cookie, ordered, { stage: "spotted", at: thisWeekAt() });
    expect(await spent()).toBe(2000);
  });

  it("the bulk stage change from ordered to spotted credits too", async () => {
    const { cookie } = await t.signIn();
    const moi = await moiOf(cookie);
    const item = await wish(cookie);
    await stage(cookie, item, { stage: "ordered", at: thisWeekAt(), amountCents: 4000 });
    expect((await call("PUT", `/api/me/profiles/${moi}/budget`, cookie, weekly)).status).toBe(200);
    const res = await call("POST", "/api/me/items/bulk", cookie, {
      ids: [item],
      op: "stage",
      stage: "spotted",
      at: thisWeekAt(),
    });
    expect(res.status).toBe(200);
    const view = (await (await call("GET", `/api/me/profiles/${moi}/budget`, cookie)).json()) as BudgetView;
    expect(view.current?.spentCents).toBe(0);
  });

  it("PUT updates the one budget in place; DELETE removes it", async () => {
    const { cookie } = await t.signIn();
    const moi = await moiOf(cookie);
    expect((await call("PUT", `/api/me/profiles/${moi}/budget`, cookie, weekly)).status).toBe(200);
    const res = await call("PUT", `/api/me/profiles/${moi}/budget`, cookie, { amountCents: 20000, period: "month" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ amountCents: 20000, period: "month", ended: false });
    expect(await t.db.select().from(schema.budgets).where(eq(schema.budgets.profileId, moi))).toHaveLength(1);
    expect((await call("DELETE", `/api/me/profiles/${moi}/budget`, cookie)).status).toBe(204);
    expect((await call("GET", `/api/me/profiles/${moi}/budget`, cookie)).status).toBe(404);
    expect((await call("DELETE", `/api/me/profiles/${moi}/budget`, cookie)).status).toBe(404);
  });

  it("a list budget counts only the list's items; the profile's counts them all", async () => {
    const { cookie } = await t.signIn();
    const moi = await moiOf(cookie);
    const list = await newList(cookie);
    const inList = await wish(cookie, list);
    const outside = await wish(cookie);
    await stage(cookie, inList, { stage: "ordered", at: thisWeekAt(), amountCents: 2000 });
    await stage(cookie, outside, { stage: "ordered", at: thisWeekAt() }); // shop price, 50 €
    const res = await call("PUT", `/api/me/wishlists/${list}/budget`, cookie, { amountCents: 30000, period: "week" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as BudgetView).current).toMatchObject({ spentCents: 2000, remainingCents: 28000 });
    await call("PUT", `/api/me/profiles/${moi}/budget`, cookie, weekly);
    const profile = (await (await call("GET", `/api/me/profiles/${moi}/budget`, cookie)).json()) as BudgetView;
    expect(profile.current?.spentCents).toBe(7000);
  });

  it("history lists the past weeks since the budget was created, at its current amount", async () => {
    const { cookie } = await t.signIn();
    const moi = await moiOf(cookie);
    const item = await wish(cookie);
    await stage(cookie, item, { stage: "ordered", at: lastWeekAt(), amountCents: 3000 });
    expect((await call("PUT", `/api/me/profiles/${moi}/budget`, cookie, weekly)).status).toBe(200);
    const fresh = await call("GET", `/api/me/profiles/${moi}/budget/history`, cookie);
    expect(fresh.status).toBe(200);
    expect(await fresh.json()).toEqual({ periods: [] }); // created this week

    const threeWeeksAgo = new Date(thisWeek().start.getTime() - 20 * 24 * 60 * 60 * 1000);
    await t.db.update(schema.budgets).set({ createdAt: threeWeeksAgo }).where(eq(schema.budgets.profileId, moi));
    const { periods } = (await (
      await call("GET", `/api/me/profiles/${moi}/budget/history`, cookie)
    ).json()) as BudgetHistory;
    expect(periods).toHaveLength(3);
    expect(periods[0]).toEqual({
      start: weekOf(new Date(lastWeekAt())).start.toISOString(),
      end: thisWeek().start.toISOString(),
      spentCents: 3000,
      amountCents: 15000,
    });
    expect(periods.slice(1).map((p) => p.spentCents)).toEqual([0, 0]);
  });

  it("resets a budget without period, and refuses to reset a weekly one (409)", async () => {
    const { cookie } = await t.signIn();
    const moi = await moiOf(cookie);
    const list = await newList(cookie);
    const put = await call("PUT", `/api/me/profiles/${moi}/budget`, cookie, { amountCents: 50000, period: "none" });
    expect(put.status).toBe(200);
    const item = await wish(cookie, list);
    await stage(cookie, item, { stage: "ordered", at: new Date().toISOString(), amountCents: 4200 });
    const before = (await (await call("GET", `/api/me/profiles/${moi}/budget`, cookie)).json()) as BudgetView;
    expect(before.current).toMatchObject({ spentCents: 4200, remainingCents: 45800, end: "9999-12-31T00:00:00.000Z" });
    expect(await (await call("GET", `/api/me/profiles/${moi}/budget/history`, cookie)).json()).toEqual({
      periods: [],
    });

    const reset = await call("POST", `/api/me/profiles/${moi}/budget/reset`, cookie);
    expect(reset.status).toBe(200);
    expect(((await reset.json()) as BudgetView).current).toMatchObject({ spentCents: 0, remainingCents: 50000 });
    // Changing the amount keeps the reset.
    const again = await call("PUT", `/api/me/profiles/${moi}/budget`, cookie, { amountCents: 60000, period: "none" });
    expect(((await again.json()) as BudgetView).current?.spentCents).toBe(0);

    await call("PUT", `/api/me/wishlists/${list}/budget`, cookie, weekly);
    const refused = await call("POST", `/api/me/wishlists/${list}/budget/reset`, cookie);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "budget_not_resettable" });
  });

  it("custom dates: required and in order (400), shown as ended after the last day", async () => {
    const { cookie } = await t.signIn();
    const moi = await moiOf(cookie);
    const path = `/api/me/profiles/${moi}/budget`;
    for (const body of [
      { amountCents: 1000, period: "custom" },
      { amountCents: 1000, period: "custom", startsOn: "2026-12-01" },
      { amountCents: 1000, period: "custom", startsOn: "2026-12-15", endsOn: "2026-12-01" },
      { amountCents: 1000, period: "week", startsOn: "2026-12-01", endsOn: "2026-12-15" },
      { amountCents: 0, period: "week" },
      { amountCents: 1000, period: "year" },
    ]) {
      const res = await call("PUT", path, cookie, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
    }
    const past = await call("PUT", path, cookie, {
      amountCents: 1000,
      period: "custom",
      startsOn: "2020-12-01",
      endsOn: "2020-12-15",
    });
    expect(past.status).toBe(200);
    expect(await past.json()).toEqual({
      amountCents: 1000,
      period: "custom",
      startsOn: "2020-12-01",
      endsOn: "2020-12-15",
      current: null,
      ended: true,
    });
    const future = await call("PUT", path, cookie, {
      amountCents: 1000,
      period: "custom",
      startsOn: "2999-12-01",
      endsOn: "2999-12-15",
    });
    expect(await future.json()).toMatchObject({
      current: { start: "2999-11-30T23:00:00.000Z", end: "2999-12-15T23:00:00.000Z", spentCents: 0 },
      ended: false,
    });
  });

  it("another account's profile or list, or an unknown id: 404", async () => {
    const owner = await t.signIn();
    const moi = await moiOf(owner.cookie);
    const list = await newList(owner.cookie);
    await call("PUT", `/api/me/profiles/${moi}/budget`, owner.cookie, weekly);
    await call("PUT", `/api/me/wishlists/${list}/budget`, owner.cookie, weekly);
    const other = await t.signIn();
    for (const base of [`/api/me/profiles/${moi}`, `/api/me/wishlists/${list}`]) {
      for (const [method, suffix, body] of [
        ["GET", "/budget", undefined],
        ["PUT", "/budget", weekly],
        ["DELETE", "/budget", undefined],
        ["GET", "/budget/history", undefined],
        ["POST", "/budget/reset", undefined],
      ] as const) {
        const res = await call(method, `${base}${suffix}`, other.cookie, body);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: "not_found" });
      }
    }
    expect(await t.db.select().from(schema.budgets).where(eq(schema.budgets.userId, other.userId))).toEqual([]);
    expect((await call("GET", "/api/me/profiles/not-a-uuid/budget", other.cookie)).status).toBe(400);
  });
});
