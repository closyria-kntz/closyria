import { adminOverviewSchema } from "@closyria/shared";
import { describe, expect, it, vi } from "vitest";
import { fetchAdminJson, fetchAdminSession, internalApiUrl } from "./admin-api";

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Response.json(body, { status });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const overview = { users: { total: 3, anonymous: 1, registered: 2 }, eventsToday: 4, signupsToday: 1 };

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
