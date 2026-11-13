import { createDb, eq, readShopifySlowdown, recordShopifyRejection, schema } from "@closyria/db";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { importIntervals, lastNightlyStart, planCatalogueImports } from "./plan-imports";

// « Stocks frais »: the catalogue read again every hour (3 h for big shops), slowed down when Shopify asks.

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let handle: ReturnType<typeof createDb>;
let counter = 0;

beforeAll(async () => {
  database = await createTestDatabase();
  handle = createDb(database.url, { max: 4 });
}, 60_000);

afterAll(async () => {
  await handle?.pool.end();
  await database?.stop();
});

beforeEach(async () => {
  await handle.db.delete(schema.crawlSlowdowns);
  await handle.db.delete(schema.shops);
});

const MIN = 60_000;
const HOUR = 60 * MIN;
// A Friday, 10:00 in Paris (winter time).
const NOW = new Date("2026-11-13T09:00:00Z");

async function shop(values: Partial<typeof schema.shops.$inferInsert> = {}) {
  const n = ++counter;
  const [row] = await handle.db
    .insert(schema.shops)
    .values({
      name: `Plan ${n}`,
      slug: `plan-${n}`,
      platform: "shopify",
      status: "published",
      importEnabled: true,
      ...values,
    })
    .returning();
  if (!row) throw new Error("no shop");
  return row;
}

/** Started `ms` ago, finished (no import under way). */
const startedAgo = (ms: number, at = NOW) => ({ importStartedAt: new Date(at.getTime() - ms) });

async function plan(at = NOW) {
  const sent: string[] = [];
  await planCatalogueImports(
    handle.db,
    {
      send: async (_queue, data) => {
        sent.push((data as { shopId: string }).shopId);
      },
    },
    at,
  );
  return sent;
}

describe("planCatalogueImports — intervals", () => {
  it("reads a shop again every hour: due after 1 h (within the planner's 5 min), not before", async () => {
    const never = await shop();
    const hourAgo = await shop(startedAgo(62 * MIN));
    // Started a few minutes after the tick of an hour ago: still this tick's.
    const justUnder = await shop(startedAgo(57 * MIN));
    await shop(startedAgo(40 * MIN));
    expect(new Set(await plan())).toEqual(new Set([never.id, hourAgo.id, justUnder.id]));
  });

  it("reads a shop of more than 5 000 products every 3 h", async () => {
    const due = await shop({ lastImportSeen: 6000, ...startedAgo(3 * HOUR) });
    await shop({ lastImportSeen: 6000, ...startedAgo(2 * HOUR) });
    // 5 000 exactly is not « more than ».
    const limit = await shop({ lastImportSeen: 5000, ...startedAgo(2 * HOUR) });
    expect(new Set(await plan())).toEqual(new Set([due.id, limit.id]));
  });

  it("never queues a shop whose import is under way, and replaces a dead one", async () => {
    await shop({ importState: "queued", ...startedAgo(2 * HOUR) });
    await shop({ importState: "running", ...startedAgo(2 * HOUR), importHeartbeatAt: new Date(NOW.getTime() - MIN) });
    const dead = await shop({
      importState: "running",
      ...startedAgo(2 * HOUR),
      importHeartbeatAt: new Date(NOW.getTime() - 20 * MIN),
    });
    expect(await plan()).toEqual([dead.id]);
    const [row] = await handle.db.select().from(schema.shops).where(eq(schema.shops.id, dead.id));
    expect(row).toMatchObject({ importState: "queued", importStartedAt: NOW });
  });

  it("never queues a refused, merged, unpublished, off or non-Shopify shop", async () => {
    const on = await shop();
    await shop({ status: "refused" });
    await shop({ status: "pending" });
    await shop({ status: "draft" });
    await shop({ mergedIntoId: on.id });
    await shop({ importEnabled: false });
    await shop({ platform: "other" });
    expect(await plan()).toEqual([on.id]);
  });

  it("a shop just queued is not queued again on the next tick", async () => {
    const s = await shop();
    expect(await plan()).toEqual([s.id]);
    await handle.db.update(schema.shops).set({ importState: null }).where(eq(schema.shops.id, s.id));
    expect(await plan(new Date(NOW.getTime() + 15 * MIN))).toEqual([]);
    expect(await plan(new Date(NOW.getTime() + 60 * MIN))).toEqual([s.id]);
  });
});

describe("Shopify slow-down", () => {
  it("a 429/430 doubles the intervals for 6 h; a second within them goes nightly for 24 h; then it ends", async () => {
    const db = handle.db;
    expect(await readShopifySlowdown(db, NOW)).toBeNull();

    expect(await recordShopifyRejection(db, NOW)).toEqual({
      level: "doubled",
      until: new Date(NOW.getTime() + 6 * HOUR),
    });
    expect(await readShopifySlowdown(db, new Date(NOW.getTime() + 5 * HOUR))).toMatchObject({ level: "doubled" });

    const second = new Date(NOW.getTime() + 5 * HOUR);
    expect(await recordShopifyRejection(db, second)).toEqual({
      level: "nightly",
      until: new Date(second.getTime() + 24 * HOUR),
    });
    // Another one during the nightly rhythm: 24 h from it, never shorter.
    const third = new Date(second.getTime() + HOUR);
    expect(await recordShopifyRejection(db, third)).toEqual({
      level: "nightly",
      until: new Date(third.getTime() + 24 * HOUR),
    });

    const over = new Date(third.getTime() + 24 * HOUR);
    expect(await readShopifySlowdown(db, over)).toBeNull();
    // Once it is over, the next rejection starts again at « doubled ».
    expect(await recordShopifyRejection(db, over)).toEqual({
      level: "doubled",
      until: new Date(over.getTime() + 6 * HOUR),
    });
  });

  it("a burst stays doubled: two hits 5 s apart change nothing, a hit 15 min after the first goes nightly", async () => {
    const db = handle.db;
    const doubled = { level: "doubled", until: new Date(NOW.getTime() + 6 * HOUR) };
    expect(await recordShopifyRejection(db, NOW)).toEqual(doubled);
    // Inside the first 10 min: the same burst, the window is not moved either.
    expect(await recordShopifyRejection(db, new Date(NOW.getTime() + 5_000))).toEqual(doubled);
    expect(await recordShopifyRejection(db, new Date(NOW.getTime() + 9 * MIN))).toEqual(doubled);
    const later = new Date(NOW.getTime() + 15 * MIN);
    expect(await recordShopifyRejection(db, later)).toEqual({
      level: "nightly",
      until: new Date(later.getTime() + 24 * HOUR),
    });
  });

  it("nightly is pushed back at most once an hour, however many hits", async () => {
    const db = handle.db;
    await recordShopifyRejection(db, NOW);
    const nightly = new Date(NOW.getTime() + 20 * MIN);
    const until = new Date(nightly.getTime() + 24 * HOUR);
    expect(await recordShopifyRejection(db, nightly)).toEqual({ level: "nightly", until });
    for (const after of [MIN, 10 * MIN, 59 * MIN]) {
      expect(await recordShopifyRejection(db, new Date(nightly.getTime() + after))).toEqual({
        level: "nightly",
        until,
      });
    }
    const hourLater = new Date(nightly.getTime() + HOUR);
    expect(await recordShopifyRejection(db, hourLater)).toEqual({
      level: "nightly",
      until: new Date(hourLater.getTime() + 24 * HOUR),
    });
    // Counted from that last extension: 30 min later, nothing again.
    expect((await recordShopifyRejection(db, new Date(hourLater.getTime() + 30 * MIN))).until).toEqual(
      new Date(hourLater.getTime() + 24 * HOUR),
    );
  });

  it("a 429 after the 6 h are over doubles again rather than going nightly", async () => {
    await recordShopifyRejection(handle.db, NOW);
    const later = new Date(NOW.getTime() + 6 * HOUR + MIN);
    expect((await recordShopifyRejection(handle.db, later)).level).toBe("doubled");
  });

  it("doubled: every 2 h, every 6 h above 5 000 products", async () => {
    await recordShopifyRejection(handle.db, new Date(NOW.getTime() - HOUR));
    const small = await shop(startedAgo(2 * HOUR));
    await shop(startedAgo(90 * MIN));
    const large = await shop({ lastImportSeen: 9000, ...startedAgo(6 * HOUR) });
    await shop({ lastImportSeen: 9000, ...startedAgo(4 * HOUR) });
    expect(new Set(await plan())).toEqual(new Set([small.id, large.id]));
  });

  it("nightly: each shop once after 03:00 (Paris), whatever its size", async () => {
    await recordShopifyRejection(handle.db, new Date(NOW.getTime() - 2 * HOUR));
    await recordShopifyRejection(handle.db, new Date(NOW.getTime() - HOUR));
    // 10:00 Paris: last night's 03:00 was 02:00 UTC.
    const beforeNight = await shop(startedAgo(8 * HOUR));
    await shop(startedAgo(6 * HOUR));
    await shop(startedAgo(2 * HOUR));
    expect(await plan()).toEqual([beforeNight.id]);

    // 02:50 Paris the next night: nothing; 03:00: every shop imported before it.
    const all = (await handle.db.select({ id: schema.shops.id }).from(schema.shops)).map((s) => s.id);
    await handle.db.update(schema.shops).set({ importState: null });
    expect(await plan(new Date("2026-11-14T01:50:00Z"))).toEqual([]);
    expect(new Set(await plan(new Date("2026-11-14T02:00:00Z")))).toEqual(new Set(all));
  });

  it("intervals per level", () => {
    expect(importIntervals(null)).toEqual({ small: HOUR, large: 3 * HOUR });
    expect(importIntervals("doubled")).toEqual({ small: 2 * HOUR, large: 6 * HOUR });
    expect(importIntervals("nightly")).toBeNull();
  });
});

describe("lastNightlyStart", () => {
  it("is the last 03:00 in Paris, winter and summer time", () => {
    expect(lastNightlyStart(new Date("2026-11-13T09:00:00Z"))).toEqual(new Date("2026-11-13T02:00:00Z"));
    expect(lastNightlyStart(new Date("2026-11-13T01:59:00Z"))).toEqual(new Date("2026-11-12T02:00:00Z"));
    expect(lastNightlyStart(new Date("2026-11-13T02:00:00Z"))).toEqual(new Date("2026-11-13T02:00:00Z"));
    expect(lastNightlyStart(new Date("2026-07-01T12:00:00Z"))).toEqual(new Date("2026-07-01T01:00:00Z"));
    expect(lastNightlyStart(new Date("2026-07-01T00:30:00Z"))).toEqual(new Date("2026-06-30T01:00:00Z"));
    // The night summer time ends (25 October 2026: 03:00 summer → 02:00 winter), then the next one.
    expect(lastNightlyStart(new Date("2026-10-25T12:00:00Z"))).toEqual(new Date("2026-10-25T02:00:00Z"));
    expect(lastNightlyStart(new Date("2026-10-26T12:00:00Z"))).toEqual(new Date("2026-10-26T02:00:00Z"));
  });
});

describe("planCatalogueImports — order", () => {
  it("queues the longest waiting first: never imported, then the oldest start", async () => {
    const recent = await shop(startedAgo(2 * HOUR));
    const oldest = await shop(startedAgo(9 * HOUR));
    const never = await shop();
    const middle = await shop(startedAgo(5 * HOUR));
    expect(await plan()).toEqual([never.id, oldest.id, middle.id, recent.id]);
  });
});
