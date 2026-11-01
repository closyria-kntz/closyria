import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { rateLimit } from "./rate-limit";

const status = async (app: Hono, headers: Record<string, string>) => (await app.request("/", { headers })).status;

const make = (opts: { max: number; maxClients?: number }) => {
  const app = new Hono();
  app.use(
    "*",
    rateLimit({ ...opts, windowMs: 60_000 }, (c) => c.json({ error: "rate_limited" }, 429)),
  );
  app.get("/", (c) => c.text("ok"));
  return (ip: string) => status(app, { "x-forwarded-for": ip });
};

describe("rateLimit", () => {
  it("uses the last X-Forwarded-For entry and ignores X-Real-IP", async () => {
    const app = new Hono();
    app.use(
      "*",
      rateLimit({ max: 1, windowMs: 60_000 }, (c) => c.json({}, 429)),
    );
    app.get("/", (c) => c.text("ok"));
    const get = (h: Record<string, string>) => status(app, h);
    expect(await get({ "x-forwarded-for": "spoofed-1, 198.51.100.1" })).toBe(200);
    expect(await get({ "x-forwarded-for": "spoofed-2, 198.51.100.1" })).toBe(429);
    expect(await get({ "x-real-ip": "a" })).toBe(200);
    expect(await get({ "x-real-ip": "b" })).toBe(429); // no header used: one shared bucket
  });

  it("evicts the oldest clients when full instead of resetting everybody", async () => {
    const hit = make({ max: 1, maxClients: 3 });
    expect(await hit("c1")).toBe(200);
    expect(await hit("c2")).toBe(200);
    expect(await hit("c3")).toBe(200);
    expect(await hit("c3")).toBe(429);
    expect(await hit("c4")).toBe(200); // evicts c1 only
    expect(await hit("c3")).toBe(429); // newer counters survive the flood
    expect(await hit("c2")).toBe(429);
    expect(await hit("c1")).toBe(200); // the oldest was forgotten
  });
});
