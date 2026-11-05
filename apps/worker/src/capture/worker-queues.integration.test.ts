import { createDb, eq, schema } from "@closyria/db";
import { memoryStore } from "@closyria/storage";
import { createTestDatabase } from "@closyria/testing/vitest";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { scheduleMonitors } from "./monitor";
import { captureHandler, monitorHandler, registerCaptureQueues } from "./queues";
import { createRobotsCache } from "./robots";
import { seedStartingShops } from "./seed-shops";
import { STARTING_SHOPS } from "./starting-shops";
import { sweepStuckCaptures } from "./sweep";
import { createThrottle } from "./throttle";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let handle: ReturnType<typeof createDb>;

beforeAll(async () => {
  database = await createTestDatabase();
  handle = createDb(database.url, { max: 4 });
}, 60_000);

afterAll(async () => {
  await handle?.pool.end();
  await database?.stop();
});

describe("seedStartingShops", () => {
  it("adds 18 shops, then nothing, and never overwrites an existing one", async () => {
    const { db } = handle;
    expect(await seedStartingShops(db)).toBe(18);
    expect(await seedStartingShops(db)).toBe(0);
    expect(await db.select().from(schema.shops)).toHaveLength(18);
    expect(await db.select().from(schema.shopDomains)).toHaveLength(18);

    await db.update(schema.shops).set({ name: "Renamed", status: "draft" }).where(eq(schema.shops.slug, "zara"));
    expect(await seedStartingShops(db)).toBe(0);
    const [zara] = await db.select().from(schema.shops).where(eq(schema.shops.slug, "zara"));
    expect(zara?.name).toBe("Renamed");
    expect(zara?.status).toBe("draft");
  });
});

describe("scheduleMonitors", () => {
  it("queues one monitor capture per published auto shop with a test page", async () => {
    const { db } = handle;
    await seedStartingShops(db); // idempotent
    await db.update(schema.shops).set({ status: "published" });
    // a draft auto shop, and a published auto shop without a test page
    await db.update(schema.shops).set({ status: "draft" }).where(eq(schema.shops.slug, "promod"));
    await db.update(schema.shops).set({ testUrl: null }).where(eq(schema.shops.slug, "zalando"));
    const sent: { queue: string; data: object }[] = [];
    const queued = await scheduleMonitors(db, {
      send: async (queue, data) => {
        sent.push({ queue, data });
      },
    });
    expect(queued).toBe(6);
    expect(sent.every((s) => s.queue === "capture-monitor")).toBe(true);
    const rows = await db.select().from(schema.captures).where(eq(schema.captures.trigger, "monitor"));
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.productId).toBeNull();
      expect(row.status).toBe("queued");
    }
    const mcb = STARTING_SHOPS.find((s) => s.slug === "mcb-paris");
    expect(rows.some((r) => r.url === mcb?.testUrl)).toBe(true);
  });
});

describe("sweepStuckCaptures", () => {
  it("fails old queued and running captures only, and flags the product unless ok or manual", async () => {
    const { db } = handle;
    const [shop] = await db.select().from(schema.shops).limit(1);
    if (!shop) throw new Error("no shop");
    const now = new Date("2026-11-05T12:00:00Z");
    const old = new Date(now.getTime() - 6 * 60_000);
    const recent = new Date(now.getTime() - 60_000);
    const product = async (n: number, captureStatus: string) => {
      const [p] = await db
        .insert(schema.products)
        .values({ shopId: shop.id, canonicalUrl: `https://sweep.test/${n}`, captureStatus })
        .returning();
      if (!p) throw new Error("no product");
      return p.id;
    };
    const pending = await product(1, "pending");
    const ok = await product(2, "ok");
    const manual = await product(3, "manual");
    const cap = async (status: string, createdAt: Date, productId: string | null, trigger = "user") => {
      const [c] = await db
        .insert(schema.captures)
        .values({ shopId: shop.id, url: "https://sweep.test/x", trigger, status, createdAt, productId })
        .returning();
      if (!c) throw new Error("no capture");
      return c.id;
    };
    const oldQueued = await cap("queued", old, pending);
    const oldRunning = await cap("running", old, ok);
    const oldManual = await cap("running", old, manual);
    const oldMonitor = await cap("queued", old, null, "monitor");
    const recentRunning = await cap("running", recent, pending);
    const oldDone = await cap("succeeded", old, pending);

    expect(await sweepStuckCaptures(db, now)).toBe(4);
    const get = async (id: string) => (await db.select().from(schema.captures).where(eq(schema.captures.id, id)))[0];
    for (const id of [oldQueued, oldRunning, oldManual, oldMonitor]) {
      const c = await get(id);
      expect(c?.status).toBe("failed");
      expect(c?.errorCode).toBe("timeout");
      expect(c?.finishedAt).toEqual(now);
    }
    expect((await get(recentRunning))?.status).toBe("running");
    expect((await get(oldDone))?.status).toBe("succeeded");
    const status = async (id: string) =>
      (await db.select().from(schema.products).where(eq(schema.products.id, id)))[0]?.captureStatus;
    expect(await status(pending)).toBe("failed");
    expect(await status(ok)).toBe("ok");
    expect(await status(manual)).toBe("manual");
  });
});

describe("job handlers", () => {
  const deps = () => ({
    db: handle.db,
    store: memoryStore(),
    robots: createRobotsCache(async () => ({ kind: "absent" }), Date.now),
    throttle: createThrottle(0),
  });
  const bad = [undefined, null, {}, { captureId: "nope" }, { captureId: 5 }, [], "x"];

  it("capture-user/admin fail a job whose data does not validate, without running a capture", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const data of bad) await expect(captureHandler(deps(), "capture-user")([{ id: "j", data }])).rejects.toThrow();
    expect(log).toHaveBeenCalledTimes(bad.length);
    log.mockRestore();
  });

  /** robots.txt disallows everything: a dispatched capture leaves `queued` (robots_disallowed), with no network. */
  const denyAll = () => ({ ...deps(), robots: { allows: async () => false } });

  async function queuedCapture(trigger: "user" | "admin_test" | "monitor") {
    const { db } = handle;
    await seedStartingShops(db);
    const [shop] = await db.select().from(schema.shops).limit(1);
    if (!shop) throw new Error("no shop");
    const [c] = await db
      .insert(schema.captures)
      .values({ shopId: shop.id, url: "https://dispatch.test/p", trigger, status: "queued" })
      .returning();
    if (!c) throw new Error("no capture");
    return c.id;
  }
  const statusOf = async (id: string) =>
    (await handle.db.select().from(schema.captures).where(eq(schema.captures.id, id)))[0];

  it("capture-user and capture-admin run a valid capture: it leaves queued", async () => {
    for (const queue of ["capture-user", "capture-admin"]) {
      const id = await queuedCapture("admin_test");
      await captureHandler(denyAll(), queue)([{ data: { captureId: id } }]);
      const c = await statusOf(id);
      expect(c?.status).toBe("failed");
      expect(c?.errorCode).toBe("robots_disallowed");
    }
  });

  it("names the real queue in the log line", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(captureHandler(deps(), "capture-admin")([{ id: "j", data: {} }])).rejects.toThrow("capture-admin");
    expect(log.mock.calls[0]?.[0]).toContain("capture-admin");
    log.mockRestore();
  });

  it("capture-monitor plans the monitors on no data or {}", async () => {
    const { db } = handle;
    await seedStartingShops(db);
    for (const data of [null, undefined, {}]) {
      const sent: { captureId: string }[] = [];
      const queue = {
        send: async (_q: string, d: object) => {
          sent.push(d as { captureId: string });
        },
      };
      await monitorHandler(deps(), queue)([{ data }]);
      expect(sent.length).toBeGreaterThan(0);
      for (const { captureId } of sent) {
        const c = await statusOf(captureId);
        expect(c?.trigger).toBe("monitor");
        expect(c?.status).toBe("queued");
      }
    }
  });

  it("capture-monitor runs a valid capture (it leaves queued) and fails anything else without planning", async () => {
    const sent: object[] = [];
    const queue = {
      send: async (_q: string, d: object) => {
        sent.push(d);
      },
    };
    const id = await queuedCapture("monitor");
    await monitorHandler(denyAll(), queue)([{ data: { captureId: id } }]);
    expect((await statusOf(id))?.status).toBe("failed");
    expect(sent).toHaveLength(0);

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const data of [{ captureId: "nope" }, { other: 1 }, [], "x", 5]) {
      await expect(monitorHandler(denyAll(), queue)([{ data }])).rejects.toThrow();
    }
    expect(sent).toHaveLength(0);
    log.mockRestore();
  });
});

describe("registerCaptureQueues", () => {
  it("hands an injected DNS lookup and throttle to the captures (browser tests: loopback names, no spacing)", async () => {
    const { db } = handle;
    await seedStartingShops(db);
    const [shop] = await db.select().from(schema.shops).limit(1);
    if (!shop) throw new Error("no shop");
    // localhost resolves from /etc/hosts without the network: the real lookup would be used without injection.
    const [capture] = await db
      .insert(schema.captures)
      .values({ shopId: shop.id, url: "https://localhost/products/robe", trigger: "admin_test", status: "queued" })
      .returning();
    if (!capture) throw new Error("no capture");

    const handlers = new Map<string, (jobs: { id?: string; data: unknown }[]) => Promise<void>>();
    const boss = {
      createQueue: async () => {},
      schedule: async () => {},
      work: async (name: string, _options: object, handler: (jobs: { data: unknown }[]) => Promise<void>) => {
        handlers.set(name, handler);
        return name;
      },
    } as unknown as PgBoss;
    const looked: string[] = [];
    const lookup = ((host: string, _options: unknown, callback: (error: Error | null) => void) => {
      looked.push(host);
      callback(Object.assign(new Error(`no DNS in tests: ${host}`), { code: "ENOTFOUND" }));
    }) as unknown as typeof import("node:dns").lookup;
    const waited: string[] = [];
    const throttle = {
      wait: async (domain: string) => {
        waited.push(domain);
      },
    };

    await registerCaptureQueues(boss, { db, store: memoryStore(), lookup, throttle });
    await handlers.get("capture-admin")?.([{ id: "j", data: { captureId: capture.id } }]);

    expect(waited.length).toBeGreaterThan(0);
    expect(new Set(waited)).toEqual(new Set(["localhost"]));
    expect(looked).toContain("localhost");
    const [row] = await db.select().from(schema.captures).where(eq(schema.captures.id, capture.id));
    expect(row?.status).toBe("failed");
  });
});
