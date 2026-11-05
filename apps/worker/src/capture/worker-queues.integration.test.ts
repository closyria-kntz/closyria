import { createDb, eq, schema } from "@closyria/db";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scheduleMonitors } from "./monitor";
import { seedStartingShops } from "./seed-shops";
import { STARTING_SHOPS } from "./starting-shops";
import { sweepStuckCaptures } from "./sweep";

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
