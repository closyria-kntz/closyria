import { adminOverviewSchema } from "@closyria/shared";
import { describe, expect, it, vi } from "vitest";
import {
  adminFailuresPath,
  adminShopsPath,
  fetchAdminFailures,
  fetchAdminJson,
  fetchAdminSession,
  fetchAdminShop,
  fetchAdminShops,
  internalApiFor,
  internalApiUrl,
} from "./admin-api";

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Response.json(body, { status });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const overview = {
  users: { total: 3, anonymous: 1, registered: 2 },
  eventsToday: 4,
  signupsToday: 1,
  captures: {
    last24h: 0,
    last7d: 0,
    successRate7d: null,
    byMethod: { shopify: 0, jsonld: 0, opengraph: 0 },
    medianDurationMs: null,
  },
  shops: { pending: 0, down: 0 },
};

describe("internalApiUrl", () => {
  it("defaults to the local API and accepts a configured URL", () => {
    expect(internalApiUrl({})).toBe("http://127.0.0.1:3001");
    expect(internalApiUrl({ INTERNAL_API_URL: "http://127.0.0.1:3101" })).toBe("http://127.0.0.1:3101");
  });

  it("refuses a malformed URL", () => {
    expect(() => internalApiUrl({ INTERNAL_API_URL: "not a url" })).toThrow();
  });
});

describe("fetchAdminSession", () => {
  it("forwards the cookies to Better Auth, uncached, and keeps only role and sign-in method", async () => {
    const { fetch, calls } = fakeFetch(200, {
      user: { id: "u1", email: "a@b.fr", role: "admin" },
      session: { token: "t", authMethod: "passkey" },
    });
    const session = await fetchAdminSession({ fetch, baseUrl: "http://api", cookie: "a=1; b=2" });
    expect(session).toEqual({ user: { role: "admin" }, session: { authMethod: "passkey" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://api/api/auth/get-session");
    expect(new Headers(calls[0]?.init?.headers).get("cookie")).toBe("a=1; b=2");
    expect(calls[0]?.init?.cache).toBe("no-store");
  });

  it("returns null without a session", async () => {
    const { fetch } = fakeFetch(200, null);
    expect(await fetchAdminSession({ fetch, baseUrl: "http://api", cookie: "" })).toBeNull();
  });

  it("throws when the API fails, rather than guessing", async () => {
    const { fetch } = fakeFetch(500, { error: "boom" });
    await expect(fetchAdminSession({ fetch, baseUrl: "http://api", cookie: "" })).rejects.toThrow();
  });
});

describe("visitor address", () => {
  it("reads cookies and the visitor's address (last X-Forwarded-For entry) from the page request", () => {
    const incoming = new Headers({ cookie: "a=1", "x-forwarded-for": "spoofed, 203.0.113.9" });
    const api = internalApiFor(incoming, { INTERNAL_API_URL: "http://127.0.0.1:3101" });
    expect(api).toMatchObject({ baseUrl: "http://127.0.0.1:3101", cookie: "a=1", visitorAddress: "203.0.113.9" });
    expect(internalApiFor(new Headers(), {}).visitorAddress).toBeUndefined();
  });

  it("forwards the visitor's address to every internal call", async () => {
    const { fetch, calls } = fakeFetch(200, overview);
    const api = { fetch, baseUrl: "http://api", cookie: "", visitorAddress: "203.0.113.9" };
    await fetchAdminJson(api, "/api/admin/overview", adminOverviewSchema);
    const session = fakeFetch(200, null);
    await fetchAdminSession({ ...api, fetch: session.fetch });
    for (const call of [...calls, ...session.calls]) {
      expect(new Headers(call.init?.headers).get("x-forwarded-for")).toBe("203.0.113.9");
    }
  });

  it("sends no X-Forwarded-For without a visitor address", async () => {
    const { fetch, calls } = fakeFetch(200, null);
    await fetchAdminSession({ fetch, baseUrl: "http://api", cookie: "" });
    expect(new Headers(calls[0]?.init?.headers).has("x-forwarded-for")).toBe(false);
  });
});

describe("fetchAdminJson", () => {
  it("returns the validated body", async () => {
    const { fetch, calls } = fakeFetch(200, overview);
    const result = await fetchAdminJson(
      { fetch, baseUrl: "http://api", cookie: "c=1" },
      "/api/admin/overview",
      adminOverviewSchema,
    );
    expect(result).toEqual({ ok: true, data: overview });
    expect(new Headers(calls[0]?.init?.headers).get("cookie")).toBe("c=1");
  });

  it("reports a refusal (401, 403) without throwing", async () => {
    for (const status of [401, 403]) {
      const { fetch } = fakeFetch(status, { error: "forbidden" });
      expect(await fetchAdminJson({ fetch, baseUrl: "http://api", cookie: "" }, "/x", adminOverviewSchema)).toEqual({
        ok: false,
        status,
      });
    }
  });

  it("throws on a body that does not match the schema", async () => {
    const { fetch } = fakeFetch(200, { users: 1 });
    await expect(
      fetchAdminJson({ fetch, baseUrl: "http://api", cookie: "" }, "/x", adminOverviewSchema),
    ).rejects.toThrow();
  });
});

describe("internal API timeout", () => {
  it("gives every internal call a 5 s abort signal", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { fetch, calls } = fakeFetch(200, overview);
    await fetchAdminJson({ fetch, baseUrl: "http://api", cookie: "" }, "/api/admin/overview", adminOverviewSchema);
    const session = fakeFetch(200, null);
    await fetchAdminSession({ fetch: session.fetch, baseUrl: "http://api", cookie: "" });
    expect(timeout).toHaveBeenCalledWith(5000);
    for (const call of [...calls, ...session.calls]) expect(call.init?.signal).toBeInstanceOf(AbortSignal);
    timeout.mockRestore();
  });
});

const shopId = "11111111-1111-4111-8111-111111111111";
const shop = {
  id: shopId,
  name: "Mango",
  slug: "mango",
  status: "published",
  platform: "other",
  captureMode: "auto",
  listingKind: "catalog",
  testUrl: null,
  domains: ["mango.com"],
  health: "ok",
  createdAt: "2026-11-01T10:00:00.000Z",
};

describe("shop and capture reads", () => {
  const api = (fetch: typeof globalThis.fetch) => ({ fetch, baseUrl: "http://api", cookie: "c=1" });

  it("builds the list path from the filters, leaving out the empty ones", () => {
    expect(adminShopsPath({})).toBe("/api/admin/shops");
    expect(adminShopsPath({ status: "pending", mode: "", health: "down" })).toBe(
      "/api/admin/shops?status=pending&health=down",
    );
    expect(adminFailuresPath({ shopId, errorCode: "blocked" })).toBe(
      `/api/admin/captures/failures?shopId=${shopId}&errorCode=blocked`,
    );
    expect(adminFailuresPath({})).toBe("/api/admin/captures/failures");
  });

  it("reads and validates the shop list", async () => {
    const { fetch, calls } = fakeFetch(200, { shops: [{ ...shop, recentProducts: 2, lastCapture: null }] });
    const result = await fetchAdminShops(api(fetch), { status: "published" });
    expect(calls[0]?.url).toBe("http://api/api/admin/shops?status=published");
    expect(result.ok && result.data.shops[0]?.name).toBe("Mango");
  });

  it("rejects a shop list that does not match the schema", async () => {
    const { fetch } = fakeFetch(200, { shops: [{ id: "x" }] });
    await expect(fetchAdminShops(api(fetch), {})).rejects.toThrow();
  });

  it("reads a shop and reports an unknown one", async () => {
    const detail = { ...shop, successRate7d: 0.9, lastMonitors: [true], lastMonitor: null, recentErrors: [] };
    const ok = fakeFetch(200, detail);
    const found = await fetchAdminShop(api(ok.fetch), shopId);
    expect(ok.calls[0]?.url).toBe(`http://api/api/admin/shops/${shopId}`);
    expect(found.ok && found.data.successRate7d).toBe(0.9);
    const missing = fakeFetch(404, { error: "not_found" });
    expect(await fetchAdminShop(api(missing.fetch), shopId)).toEqual({ ok: false, status: 404 });
  });

  it("reads the failed captures", async () => {
    const failure = {
      id: shopId,
      shopId,
      shopName: "Mango",
      productId: null,
      url: "https://mango.com/p",
      trigger: "user",
      errorCode: "blocked",
      httpStatus: 403,
      createdAt: "2026-11-01T10:00:00.000Z",
    };
    const { fetch, calls } = fakeFetch(200, { failures: [failure] });
    const result = await fetchAdminFailures(api(fetch), { errorCode: "blocked" });
    expect(calls[0]?.url).toBe("http://api/api/admin/captures/failures?errorCode=blocked");
    expect(result.ok && result.data.failures).toHaveLength(1);
  });

  it("refuses a shop id that is not a UUID before calling the API", async () => {
    const { fetch, calls } = fakeFetch(200, shop);
    expect(await fetchAdminShop(api(fetch), "../audit")).toEqual({ ok: false, status: 404 });
    expect(calls).toHaveLength(0);
  });
});
