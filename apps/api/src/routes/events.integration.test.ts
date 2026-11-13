import { createAuth, memoryMailer } from "@closyria/auth";
import { createDb, eq, schema, trackServer } from "@closyria/db";
import { memoryStore } from "@closyria/storage";
import type { TestDatabase } from "@closyria/testing";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";

const BASE_URL = "http://localhost:3001";
const NOW = new Date("2026-11-01T12:00:00.000Z");
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const RATE_LIMIT = 5;

let database: TestDatabase;
let handle: ReturnType<typeof createDb>;
let auth: ReturnType<typeof createAuth>;
let app: ReturnType<typeof createApp>;
let counter = 0;

const event = (over: Record<string, unknown> = {}) => ({
  name: "page_view",
  path: "/",
  occurredAt: NOW.toISOString(),
  ...over,
});

/** Each test uses its own client address so the rate limit of one never hits another. */
function post(body: unknown, headers: Record<string, string> = {}, raw?: string) {
  return app.request("/api/events", {
    method: "POST",
    body: raw ?? JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${++counter}`, ...headers },
  });
}

async function signIn() {
  const res = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { origin: BASE_URL, "x-forwarded-for": `10.3.0.${++counter}`, "user-agent": "closyria-tests" },
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { user: { id: string } };
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { cookie, userId: body.user.id };
}

beforeAll(async () => {
  database = await createTestDatabase();
  handle = createDb(database.url, { max: 5 });
  vi.spyOn(console, "log").mockImplementation(() => {});
  auth = createAuth({
    db: handle.db,
    mailer: memoryMailer(),
    baseUrl: BASE_URL,
    secret: "test-secret-that-is-long-enough-0123456789",
  });
  app = createApp({
    origin: BASE_URL,
    env: "test",
    version: "test",
    pingDb: async () => true,
    auth,
    media: { db: handle.db, store: memoryStore() },
    catalog: {
      db: handle.db,
      store: memoryStore(),
      queue: { enqueue: async () => {}, importCatalogue: async () => true, refreshProduct: async () => true },
    },
    events: { db: handle.db, now: () => NOW, rateLimit: { max: RATE_LIMIT, windowMs: 60_000 } },
    admin: { db: handle.db },
    wardrobe: { db: handle.db, shareLinkKey: Buffer.alloc(32) },
  });
}, 60_000);

beforeEach(async () => {
  await handle.db.delete(schema.events);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await handle?.pool.end();
  await database?.stop();
});

describe("POST /api/events", () => {
  it("stores a batch of anonymous events with the device family and no user", async () => {
    const res = await post(
      { events: [event(), event({ name: "signup_started", path: "/signup", props: { step: 1, source: "hero" } })] },
      { "user-agent": IPHONE },
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 2 });
    const rows = await handle.db.select().from(schema.events);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.userId === null && r.device === "mobile")).toBe(true);
    expect(rows.find((r) => r.name === "signup_started")?.props).toEqual({ step: 1, source: "hero" });
    expect(rows[0]?.occurredAt.toISOString()).toBe(NOW.toISOString());
    expect(rows[0]?.receivedAt).toBeInstanceOf(Date);
  });

  it("stores neither an IP address nor the user agent: the table has no column for them", async () => {
    await post({ events: [event()] }, { "user-agent": IPHONE, "x-real-ip": "203.0.113.9" });
    const columns = await handle.pool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'events'",
    );
    expect(columns.rows.map((c) => c.column_name).sort()).toEqual([
      "device",
      "id",
      "name",
      "occurred_at",
      "path",
      "props",
      "received_at",
      "user_id",
    ]);
    const dump = JSON.stringify(await handle.db.select().from(schema.events));
    expect(dump).not.toMatch(/203\.0\.113|192\.0\.2|iPhone|Mozilla/);
  });

  it("derives tablet and desktop", async () => {
    await post({ events: [event({ path: "/a" })] }, { "user-agent": "Mozilla/5.0 (iPad; CPU OS 19_0 like Mac OS X)" });
    await post({ events: [event({ path: "/b" })] });
    const rows = await handle.db.select().from(schema.events);
    expect(Object.fromEntries(rows.map((r) => [r.path, r.device]))).toEqual({ "/a": "tablet", "/b": "desktop" });
  });

  it("strips the query string and the fragment from the path", async () => {
    await post({ events: [event({ path: "/items/42?email=a%40b.fr#top" })] });
    const [row] = await handle.db.select().from(schema.events);
    expect(row?.path).toBe("/items/42");
  });

  it("stores a route template with brackets and dots verbatim", async () => {
    const res = await post({
      events: [event({ path: "/items/[id]" }), event({ path: "/docs/[...slug]" }), event({ path: "/[unknown]" })],
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 3 });
    const rows = await handle.db.select().from(schema.events);
    expect(rows.map((r) => r.path).sort()).toEqual(["/[unknown]", "/docs/[...slug]", "/items/[id]"]);
  });

  it("attaches the user of the session when there is one", async () => {
    const { cookie, userId } = await signIn();
    const res = await post({ events: [event()] }, { cookie });
    expect(res.status).toBe(202);
    const [row] = await handle.db.select().from(schema.events);
    expect(row?.userId).toBe(userId);
  });

  it("still records the event as anonymous when the session cookie is invalid", async () => {
    const res = await post({ events: [event()] }, { cookie: "better-auth.session_token=garbage" });
    expect(res.status).toBe(202);
    const [row] = await handle.db.select().from(schema.events);
    expect(row?.userId).toBeNull();
  });

  it("answers 400 invalid_event for 21 events in one batch", async () => {
    const res = await post({ events: Array.from({ length: 21 }, () => event()) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_event" });
    expect(await handle.db.select().from(schema.events)).toHaveLength(0);
  });

  it("answers 400 for an unknown name, an empty batch, a bad date and malformed JSON", async () => {
    for (const body of [
      { events: [event({ name: "hack" })] },
      { events: [] },
      { events: [event({ occurredAt: "yesterday" })] },
      { events: [event({ props: { nested: { a: 1 } } })] },
    ]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_event" });
    }
    const bad = await post(null, {}, "{not json");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_event" });
  });

  it("refuses events older than 7 days or more than 5 minutes ahead, the whole batch with them", async () => {
    const old = new Date(NOW.getTime() - 7 * 86_400_000 - 1000).toISOString();
    const future = new Date(NOW.getTime() + 5 * 60_000 + 1000).toISOString();
    for (const occurredAt of [old, future]) {
      const res = await post({ events: [event(), event({ occurredAt })] });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_event" });
    }
    expect(await handle.db.select().from(schema.events)).toHaveLength(0);
    const edge = new Date(NOW.getTime() - 6 * 86_400_000).toISOString();
    expect((await post({ events: [event({ occurredAt: edge })] })).status).toBe(202);
  });

  it("answers 413 payload_too_large over 64 KB", async () => {
    const res = await post(null, {}, JSON.stringify({ events: [event()], padding: "x".repeat(70_000) }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload_too_large" });
  });

  it("answers 429 rate_limited past the per-client limit, per client", async () => {
    const headers = { "x-forwarded-for": "198.51.100.77" };
    for (let i = 0; i < RATE_LIMIT; i++) expect((await post({ events: [event()] }, headers)).status).toBe(202);
    const limited = await post({ events: [event()] }, headers);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect((await post({ events: [event()] }, { "x-forwarded-for": "198.51.100.78" })).status).toBe(202);
  });

  it("is a public operation of the OpenAPI document", async () => {
    const doc = (await (await app.request("/api/openapi.json")).json()) as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
    };
    expect(doc.paths["/api/events"]?.post?.["x-access"]).toBe("public");
  });
});

describe("trackServer", () => {
  it("inserts one event or a batch with no user and no device by default", async () => {
    await trackServer(handle.db, { name: "signup_completed", path: "/signup" });
    await trackServer(handle.db, [
      { name: "page_view", path: "/a", device: "desktop" },
      { name: "page_view", path: "/b", props: { k: "v" } },
    ]);
    await trackServer(handle.db, []);
    const rows = await handle.db.select().from(schema.events);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.name === "signup_completed")).toMatchObject({ userId: null, device: null, props: null });
  });
});

describe("events as user data", () => {
  it("are deleted with the account", async () => {
    const { cookie, userId } = await signIn();
    await post({ events: [event()] }, { cookie });
    await handle.db.delete(schema.user).where(eq(schema.user.id, userId));
    expect(await handle.db.select().from(schema.events)).toHaveLength(0);
  });
});
