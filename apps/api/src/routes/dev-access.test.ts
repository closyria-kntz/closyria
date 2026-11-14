import * as crypto from "node:crypto";
import type { Database } from "@closyria/db";
import { memoryStore } from "@closyria/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findStrayRoutes, findUndeclaredOperations, type OpenApiDocument } from "../access";
import { createApp } from "../app";
import type { DevAccessDeps } from "./dev-access";

// Spied on to prove the password is compared in constant time (the real function still answers).
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const ORIGIN = "http://localhost:3001";
const PASSWORD = "mot-de-passe-du-site-de-test";
const TOKEN = "0123456789abcdef".repeat(4);
const db = {} as Database; // never reached: the route needs no database

const make = (devAccess?: DevAccessDeps, env = "dev") =>
  createApp({
    env,
    version: "t",
    origin: ORIGIN,
    pingDb: async () => true,
    auth: { handler: async () => new Response(), getSession: async () => null },
    media: { db, store: memoryStore() },
    events: { db },
    catalog: {
      db,
      store: memoryStore(),
      queue: { enqueue: async () => {}, importCatalogue: async () => true, refreshProduct: async () => true },
    },
    admin: { db },
    wardrobe: { db, shareLinkKey: Buffer.alloc(32) },
    ...(devAccess ? { devAccess } : {}),
  });

let client = 0;
/** Each call comes from its own address unless one is given, so the rate limit of one test never hits another. */
const post = (app: ReturnType<typeof make>, body: unknown, ip = `198.51.100.${++client}`) =>
  app.request("/api/dev-access", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
  });

const configured = () => make({ password: PASSWORD, token: TOKEN });

afterEach(() => {
  vi.mocked(crypto.timingSafeEqual).mockClear();
  vi.restoreAllMocks();
});

describe("POST /api/dev-access", () => {
  it("does not exist without DEV_ACCESS_* (prod's case)", async () => {
    const app = make();
    expect((await post(app, { password: PASSWORD })).status).toBe(404);
    const doc = (await (await app.request("/api/openapi.json")).json()) as OpenApiDocument;
    expect(doc.paths).not.toHaveProperty("/api/dev-access");
  });

  it("refuses to be wired in prod", () => {
    expect(() => make({ password: PASSWORD, token: TOKEN }, "prod")).toThrow();
  });

  it("is a public route, declared like every other", async () => {
    const app = configured();
    const doc = (await (await app.request("/api/openapi.json")).json()) as OpenApiDocument;
    expect(doc.paths["/api/dev-access"]?.post?.["x-access"]).toBe("public");
    expect(findUndeclaredOperations(doc)).toEqual([]);
    expect(findStrayRoutes(app, doc)).toEqual([]);
  });

  it("sets the access cookie for a year with the right password: HttpOnly, Secure, SameSite=Lax, whole site", async () => {
    const res = await post(configured(), { password: PASSWORD });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    const [pair = "", ...attributes] = (cookies[0] ?? "").split(";").map((part) => part.trim());
    expect(pair).toBe(`closyria_dev_access=${TOKEN}`);
    expect(new Set(attributes)).toEqual(new Set(["Max-Age=31536000", "Path=/", "HttpOnly", "Secure", "SameSite=Lax"]));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 401 wrong_password, without a cookie, to a wrong password", async () => {
    const app = configured();
    for (const password of ["mauvais", `${PASSWORD} `, PASSWORD.toUpperCase(), PASSWORD.slice(0, -1)]) {
      const res = await post(app, { password });
      expect(res.status, password).toBe(401);
      expect(await res.json()).toEqual({ error: "wrong_password" });
      expect(res.headers.getSetCookie()).toEqual([]);
      expect(res.headers.get("www-authenticate")).toBeNull();
    }
  });

  it("answers 400 invalid_request to a malformed body", async () => {
    const app = configured();
    for (const body of [{}, { password: "" }, { password: 1 }, "{not json"]) {
      const res = await post(app, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
    }
  });

  it("compares in constant time", async () => {
    const compare = vi.mocked(crypto.timingSafeEqual);
    await post(configured(), { password: "mauvais" });
    expect(compare).toHaveBeenCalledTimes(1);
    await post(configured(), { password: PASSWORD });
    expect(compare).toHaveBeenCalledTimes(2);
  });

  it("allows 5 tries per 10 minutes per address, the right password included", async () => {
    const app = configured();
    const ip = "203.0.113.7";
    for (let i = 0; i < 5; i++) expect((await post(app, { password: "mauvais" }, ip)).status).toBe(401);
    const blocked = await post(app, { password: PASSWORD }, ip);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "rate_limited" });
    expect(blocked.headers.getSetCookie()).toEqual([]);
    // Another address is not affected.
    expect((await post(app, { password: PASSWORD }, "203.0.113.8")).status).toBe(204);
  });

  it("opens the next window after 10 minutes", async () => {
    let now = 1_000_000;
    const app = make({ password: PASSWORD, token: TOKEN, now: () => now });
    const ip = "203.0.113.9";
    for (let i = 0; i < 5; i++) await post(app, { password: "mauvais" }, ip);
    expect((await post(app, { password: PASSWORD }, ip)).status).toBe(429);
    now += 10 * 60_000;
    expect((await post(app, { password: PASSWORD }, ip)).status).toBe(204);
  });

  it("never writes the password or the token to the logs", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const app = configured();
    await post(app, { password: PASSWORD });
    await post(app, { password: "mauvais" });
    await post(app, "{not json");
    const written = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(written).not.toContain(PASSWORD);
    expect(written).not.toContain(TOKEN);
  });
});
