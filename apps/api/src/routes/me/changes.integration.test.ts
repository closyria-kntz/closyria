import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";

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

function call(method: string, path: string, cookie: string | undefined, body?: unknown) {
  return t.app.request(`/api${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

async function stampOf(cookie: string): Promise<string> {
  const res = await call("GET", "/me/changes", cookie);
  expect(res.status).toBe(200);
  const { stamp } = (await res.json()) as { stamp: string };
  expect(stamp).toMatch(/^[0-9a-f]{32}$/);
  return stamp;
}

const levels = {
  levels: [
    { level: 1, emoji: "🙁", label: "Pas trop" },
    { level: 2, emoji: "💛", label: "Joli" },
    { level: 3, emoji: "😍", label: "Adore" },
    { level: 4, emoji: "💎", label: "Coup de coeur" },
  ],
};

describe("/api/me/changes", () => {
  it("answers 401 without a session", async () => {
    expect((await call("GET", "/me/changes", undefined)).status).toBe(401);
  });

  it("keeps the same stamp while nothing changes, a new one after each of her changes", async () => {
    const { cookie } = await t.signIn();
    const first = await stampOf(cookie);
    expect(await stampOf(cookie)).toBe(first);

    expect((await call("PUT", "/me/love-levels", cookie, levels)).status).toBe(200);
    const afterLevels = await stampOf(cookie);
    expect(afterLevels).not.toBe(first);

    expect((await call("POST", "/me/wishlists", cookie, { name: "Été" })).status).toBe(201);
    const afterList = await stampOf(cookie);
    expect(afterList).not.toBe(afterLevels);
    expect(await stampOf(cookie)).toBe(afterList);
  });

  it("never moves with another account's changes", async () => {
    const mine = await t.signIn();
    const other = await t.signIn();
    const before = await stampOf(mine.cookie);
    expect((await call("PUT", "/me/love-levels", other.cookie, levels)).status).toBe(200);
    expect((await call("POST", "/me/wishlists", other.cookie, { name: "Hiver" })).status).toBe(201);
    expect(await stampOf(mine.cookie)).toBe(before);
  });
});
