import type { Database } from "@closyria/db";
import { memoryStore } from "@closyria/storage";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

const auth = {
  getSession: async () => null,
  handler: async (req: Request) => Response.json({ method: req.method, path: new URL(req.url).pathname }),
};
// The media, events and admin routes never run here: it needs no real database.
const media = { db: {} as Database, store: memoryStore() };
const events = { db: {} as Database };
const catalog = { db: {} as Database, store: memoryStore(), queue: { enqueue: async () => {} } };
const ORIGIN = "http://localhost:3001";
const make = (dbOk: boolean) =>
  createApp({
    env: "test",
    version: "abc123",
    origin: ORIGIN,
    pingDb: async () => dbOk,
    auth,
    media,
    catalog,
    events,
    admin: events,
    wardrobe: events,
  });

describe("GET /api/health", () => {
  it("returns 200 when the database answers", async () => {
    const res = await make(true).request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", env: "test", version: "abc123", database: "ok" });
  });

  it("returns 503 when the database is unreachable", async () => {
    const res = await make(false).request("/api/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "degraded", database: "error" });
  });

  it("publishes the OpenAPI document", async () => {
    const res = await make(true).request("/api/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths).toHaveProperty("/api/health");
  });
});

describe("/api/auth/*", () => {
  it("hands GET and POST requests to the auth handler", async () => {
    for (const method of ["GET", "POST"]) {
      const res = await make(true).request("/api/auth/sign-in/anonymous", { method });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ method, path: "/api/auth/sign-in/anonymous" });
    }
  });
});

describe("CSRF origin check", () => {
  const form = () => {
    const body = new FormData();
    body.set("file", new File([new Uint8Array([1])], "a.jpg", { type: "image/jpeg" }));
    return body;
  };
  const post = (path: string, headers: Record<string, string>, body: FormData | string = form()) =>
    make(true).request(path, { method: "POST", body, headers });

  it("refuses a form-like POST from another origin, or with no origin at all", async () => {
    for (const headers of [{ origin: "https://evil.example" }, {}, { "sec-fetch-site": "cross-site" }]) {
      const res = await post("/api/media", headers);
      expect(res.status, JSON.stringify(headers)).toBe(403);
    }
    const text = await post("/api/events", { origin: "https://evil.example", "content-type": "text/plain" }, "{}");
    expect(text.status).toBe(403);
  });

  it("lets the configured origin and same-origin fetches through to the route", async () => {
    // 401: the route ran (no session), the CSRF check did not answer.
    expect((await post("/api/media", { origin: ORIGIN })).status).toBe(401);
    expect((await post("/api/media", { "sec-fetch-site": "same-origin" })).status).toBe(401);
  });

  it("leaves safe methods and Better Auth (which checks its own origins) alone", async () => {
    expect((await make(true).request("/api/health", { headers: { origin: "https://evil.example" } })).status).toBe(200);
    const res = await post("/api/auth/sign-in/anonymous", { origin: "https://evil.example" });
    expect(await res.json()).toEqual({ method: "POST", path: "/api/auth/sign-in/anonymous" });
  });
});

describe("API security headers", () => {
  it("sets nosniff and a referrer policy on every response", async () => {
    for (const path of ["/api/health", "/api/openapi.json", "/api/nope"]) {
      const res = await make(true).request(path);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    }
  });
});

describe("GET /api/test/emails", () => {
  const messages = [
    { to: "a@example.com", subject: "Code", text: "123456", html: "<p>123456</p>" },
    { to: "b@example.com", subject: "Code", text: "654321", html: "<p>654321</p>" },
  ];
  const withMail = (env: string) =>
    createApp({
      env,
      version: "v",
      origin: ORIGIN,
      pingDb: async () => true,
      auth,
      media,
      catalog,
      events,
      admin: events,
      wardrobe: events,
      testMail: { messages },
    });

  it("does not exist without the test mailbox", async () => {
    expect((await make(true).request("/api/test/emails?to=a@example.com")).status).toBe(404);
  });

  it("lists the messages sent to one address when APP_ENV=test", async () => {
    const res = await withMail("test").request("/api/test/emails?to=a@example.com");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ messages: [{ to: "a@example.com", subject: "Code", text: "123456" }] });
  });

  it("requires an address", async () => {
    expect((await withMail("test").request("/api/test/emails")).status).toBe(400);
  });

  it("refuses to be wired outside APP_ENV=test", () => {
    for (const env of ["development", "dev", "prod"]) expect(() => withMail(env)).toThrow();
  });
});
