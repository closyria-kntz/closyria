import { eq, schema } from "@closyria/db";
import type { PreferencesView } from "@closyria/shared";
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

function call(method: string, cookie: string | undefined, body?: unknown) {
  return t.app.request("/api/me/preferences", {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

async function read(cookie: string): Promise<PreferencesView> {
  const res = await call("GET", cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as PreferencesView;
}

async function patch(cookie: string, body: unknown): Promise<PreferencesView> {
  const res = await call("PATCH", cookie, body);
  expect(res.status).toBe(200);
  return (await res.json()) as PreferencesView;
}

async function wish(cookie: string) {
  const n = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `Boutique P${n}`, slug: `me-prefs-shop-${n}` })
    .returning();
  if (!shop) throw new Error("no shop");
  const [product] = await t.db
    .insert(schema.products)
    .values({ shopId: shop.id, canonicalUrl: `https://me-prefs-${n}.test/p`, name: `Robe ${n}` })
    .returning();
  if (!product) throw new Error("no product");
  const res = await t.app.request("/api/me/items", {
    method: "POST",
    body: JSON.stringify({ productId: product.id, action: "wish" }),
    headers: { origin: BASE_URL, "content-type": "application/json", cookie },
  });
  expect(res.status).toBe(201);
}

describe("/api/me/preferences", () => {
  it("answers 401 without a session", async () => {
    expect((await call("GET", undefined)).status).toBe(401);
    expect((await call("PATCH", undefined, { onboarded: true })).status).toBe(401);
  });

  it("starts empty: no tip closed, discovery not done", async () => {
    const { cookie } = await t.signIn();
    expect(await read(cookie)).toEqual({ seenTips: [], onboardedAt: null });
  });

  it("keeps the closed tips, once each, in the order closed", async () => {
    const { cookie } = await t.signIn();
    expect(await patch(cookie, { seenTips: ["home-levels"] })).toEqual({
      seenTips: ["home-levels"],
      onboardedAt: null,
    });
    await patch(cookie, { seenTips: ["moi-reglages", "home-levels"] });
    expect((await read(cookie)).seenTips).toEqual(["home-levels", "moi-reglages"]);
  });

  it("marks the discovery done once, and keeps the first date", async () => {
    const { cookie } = await t.signIn();
    const first = await patch(cookie, { onboarded: true });
    expect(first.onboardedAt).not.toBeNull();
    const again = await patch(cookie, { onboarded: true, seenTips: ["home-levels"] });
    expect(again).toEqual({ seenTips: ["home-levels"], onboardedAt: first.onboardedAt });
    expect(await read(cookie)).toEqual(again);
  });

  it("counts an account that already keeps articles as done (existing accounts never get the discovery)", async () => {
    const { cookie, userId } = await t.signIn();
    await wish(cookie);
    const view = await read(cookie);
    expect(view.onboardedAt).not.toBeNull();
    const [row] = await t.db
      .select({ onboardedAt: schema.user.onboardedAt })
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    expect(row?.onboardedAt?.toISOString()).toBe(view.onboardedAt);
  });

  it("refuses an empty change, an unknown field and a malformed tip id", async () => {
    const { cookie } = await t.signIn();
    for (const body of [{}, { seenTips: [] }, { onboarded: false }, { onboardedAt: null }, { seenTips: ["Pas Ça"] }]) {
      const res = await call("PATCH", cookie, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
    }
  });

  it("keeps each account's own", async () => {
    const a = await t.signIn();
    const b = await t.signIn();
    await patch(a.cookie, { seenTips: ["home-levels"], onboarded: true });
    expect(await read(b.cookie)).toEqual({ seenTips: [], onboardedAt: null });
  });
});
