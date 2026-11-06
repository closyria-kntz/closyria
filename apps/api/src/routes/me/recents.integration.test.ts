import { randomUUID } from "node:crypto";
import { schema } from "@closyria/db";
import { RECENT_PRODUCTS_LIMIT, type RecentList } from "@closyria/shared";
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

function call(method: string, path: string, cookie?: string, body?: unknown) {
  return t.app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

const paste = (cookie: string, url: string) => call("POST", "/api/captures", cookie, { url });
const recents = async (cookie: string) =>
  ((await (await call("GET", "/api/me/recents", cookie)).json()) as RecentList).recents;
const host = () => `recents-${++counter}.test`;

async function pasteNew(cookie: string, shopHost = host(), path = "p") {
  const res = await paste(cookie, `https://${shopHost}/${path}`);
  expect(res.status).toBe(202);
  return ((await res.json()) as { productId: string }).productId;
}

describe("/api/me/recents", () => {
  it("answers 401 without a session", async () => {
    expect((await call("GET", "/api/me/recents")).status).toBe(401);
    expect((await call("DELETE", `/api/me/recents/${randomUUID()}`)).status).toBe(401);
  });

  it("records the visit even when a capture is already running for another user", async () => {
    const a = await t.signIn();
    const b = await t.signIn();
    const url = `https://${host()}/shared`;
    const first = await paste(a.cookie, url);
    expect(first.status).toBe(202);
    const { productId, status } = (await first.json()) as { productId: string; status: string };
    expect(status).toBe("queued");
    expect((await paste(b.cookie, url)).status).toBe(202);
    expect((await recents(a.cookie)).map((r) => r.product.id)).toEqual([productId]);
    expect((await recents(b.cookie)).map((r) => r.product.id)).toEqual([productId]);
  });

  it("moves a pasted link back to the top", async () => {
    const { cookie } = await t.signIn();
    const h = host();
    const a = await pasteNew(cookie, h, "a");
    const b = await pasteNew(cookie, h, "b");
    expect((await recents(cookie)).map((r) => r.product.id)).toEqual([b, a]);
    await pasteNew(cookie, h, "a");
    const list = await recents(cookie);
    expect(list.map((r) => r.product.id)).toEqual([a, b]);
    expect(list[0]?.visitedAt).toMatch(/Z$|[+-]\d\d:\d\d$/);
  });

  it("leaves out the products she keeps", async () => {
    const { cookie, userId } = await t.signIn();
    const h = host();
    const kept = await pasteNew(cookie, h, "kept");
    const other = await pasteNew(cookie, h, "other");
    const profiles = (await (await call("GET", "/api/me/profiles", cookie)).json()) as { profiles: { id: string }[] };
    const profile = profiles.profiles[0];
    if (!profile) throw new Error("no profile");
    await t.db.insert(schema.items).values({ userId, profileId: profile.id, productId: kept });
    expect((await recents(cookie)).map((r) => r.product.id)).toEqual([other]);
  });

  it("keeps 20 at most", async () => {
    const { cookie } = await t.signIn();
    const h = host();
    for (let i = 0; i < RECENT_PRODUCTS_LIMIT + 3; i++) await pasteNew(cookie, h, `n${i}`);
    expect(await recents(cookie)).toHaveLength(RECENT_PRODUCTS_LIMIT);
  });

  it("forgets one", async () => {
    const { cookie } = await t.signIn();
    const h = host();
    const a = await pasteNew(cookie, h, "a");
    const b = await pasteNew(cookie, h, "b");
    expect((await call("DELETE", `/api/me/recents/${a}`, cookie)).status).toBe(204);
    expect((await call("DELETE", `/api/me/recents/${a}`, cookie)).status).toBe(204);
    expect((await recents(cookie)).map((r) => r.product.id)).toEqual([b]);
    expect((await call("DELETE", "/api/me/recents/nope", cookie)).status).toBe(400);
  });
});
