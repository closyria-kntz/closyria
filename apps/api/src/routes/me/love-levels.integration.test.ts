import { DEFAULT_LOVE_LEVELS } from "@closyria/shared";
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

function call(method: string, cookie: string | undefined, body?: unknown) {
  return t.app.request("/api/me/love-levels", {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

const custom = (overrides: Record<number, object> = {}) => ({
  levels: [
    { level: 1, emoji: "🙁", label: "Pas trop", ...overrides[1] },
    { level: 2, emoji: "💛", label: "Joli", ...overrides[2] },
    { level: 3, emoji: "😍", label: "Adore", ...overrides[3] },
    { level: 4, emoji: "💎", label: "Coup de coeur", ...overrides[4] },
  ],
});

describe("/api/me/love-levels", () => {
  it("answers 401 without a session", async () => {
    expect((await call("GET", undefined)).status).toBe(401);
  });

  it("gives the defaults to a new account", async () => {
    const { cookie } = await t.signIn();
    const res = await call("GET", cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ levels: DEFAULT_LOVE_LEVELS });
  });

  it("returns what a PUT stored, trimming labels, and replaces it on the next PUT", async () => {
    const { cookie } = await t.signIn();
    const put = await call("PUT", cookie, custom({ 1: { label: "  Pas trop  " } }));
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual(custom());
    expect(await (await call("GET", cookie)).json()).toEqual(custom());
    const again = custom({ 3: { emoji: "🥰", label: "Mims" } });
    expect((await call("PUT", cookie, again)).status).toBe(200);
    expect(await (await call("GET", cookie)).json()).toEqual(again);
  });

  it("accepts a ZWJ sequence and a flag", async () => {
    const { cookie } = await t.signIn();
    const body = custom({ 1: { emoji: "👩🏽‍🦱" }, 2: { emoji: "🇫🇷" } });
    expect((await call("PUT", cookie, body)).status).toBe(200);
    expect(await (await call("GET", cookie)).json()).toEqual(body);
  });

  it("refuses 3 levels, a duplicated level, a long label, an empty label and two emojis", async () => {
    const { cookie } = await t.signIn();
    const refused = [
      { levels: custom().levels.slice(0, 3) },
      custom({ 4: { level: 3 } }),
      custom({ 1: { label: "x".repeat(21) } }),
      custom({ 1: { label: "   " } }),
      custom({ 1: { emoji: "😀😀" } }),
      custom({ 1: { emoji: "a" } }),
    ];
    for (const body of refused) {
      const res = await call("PUT", cookie, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
    }
    expect(await (await call("GET", cookie)).json()).toEqual({ levels: DEFAULT_LOVE_LEVELS });
  });

  it("DELETE restores the defaults", async () => {
    const { cookie } = await t.signIn();
    await call("PUT", cookie, custom());
    expect((await call("DELETE", cookie)).status).toBe(204);
    expect(await (await call("GET", cookie)).json()).toEqual({ levels: DEFAULT_LOVE_LEVELS });
    expect((await call("DELETE", cookie)).status).toBe(204);
  });

  it("never shows them to another account", async () => {
    const a = await t.signIn();
    const b = await t.signIn();
    await call("PUT", a.cookie, custom());
    expect(await (await call("GET", b.cookie)).json()).toEqual({ levels: DEFAULT_LOVE_LEVELS });
    await call("DELETE", b.cookie);
    expect(await (await call("GET", a.cookie)).json()).toEqual(custom());
  });
});
