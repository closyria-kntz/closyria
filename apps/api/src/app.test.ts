import type { Database } from "@closyria/db";
import { memoryStore } from "@closyria/storage";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

const auth = {
  getSession: async () => null,
  handler: async (req: Request) => Response.json({ method: req.method, path: new URL(req.url).pathname }),
};
// The media route never runs here: it needs no real database.
const media = { db: {} as Database, store: memoryStore() };
const make = (dbOk: boolean) => createApp({ env: "test", version: "abc123", pingDb: async () => dbOk, auth, media });

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
