import type dns from "node:dns";
import { createDb, eq, schema } from "@closyria/db";
import { CATALOGUE_IMPORT_QUEUE, CATALOGUE_IMPORT_QUEUE_OPTIONS } from "@closyria/shared";
import { memoryStore } from "@closyria/storage";
import { type FakeRoute, type FakeShop, startFakeShop } from "@closyria/testing";
import { createTestDatabase } from "@closyria/testing/vitest";
import { PgBoss } from "pg-boss";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressPolicy } from "../capture/address-policy";
import { registerCaptureQueues } from "../capture/queues";
import { seedReference } from "../capture/seed-reference";
import { loopbackForTests } from "../capture/testing";
import { stopWorker } from "../shutdown";
import { recoverInterruptedImports } from "./recover-imports";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let handle: ReturnType<typeof createDb>;
let counter = 0;
const bosses: PgBoss[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  handle = createDb(database.url, { max: 4 });
  await seedReference(handle.db);
}, 60_000);

afterEach(async () => {
  for (const boss of bosses.splice(0)) await boss.stop({ graceful: false, timeout: 1000 }).catch(() => {});
});

afterAll(async () => {
  await handle?.pool.end();
  await database?.stop();
});

async function newBoss(): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: database.url, max: 3 });
  boss.on("error", () => {});
  await boss.start();
  bosses.push(boss);
  await boss.createQueue(CATALOGUE_IMPORT_QUEUE, { ...CATALOGUE_IMPORT_QUEUE_OPTIONS });
  return boss;
}

async function newShop(over: Partial<typeof schema.shops.$inferInsert> = {}) {
  const n = ++counter;
  const [s] = await handle.db
    .insert(schema.shops)
    .values({
      name: `Recover ${n}`,
      slug: `recover-shop-${n}`,
      platform: "shopify",
      status: "published",
      importEnabled: true,
      testUrl: `https://recover-${n}.test/products/x`,
      ...over,
    })
    .returning();
  if (!s) throw new Error("no shop");
  return s;
}

const shopRow = async (id: string) => (await handle.db.select().from(schema.shops).where(eq(schema.shops.id, id)))[0];
const jobsOf = async (boss: PgBoss, shopId: string) => boss.findJobs(CATALOGUE_IMPORT_QUEUE, { key: shopId });
const states = async (boss: PgBoss, shopId: string) => (await jobsOf(boss, shopId)).map((j) => j.state).sort();

describe("recoverInterruptedImports (worker startup)", () => {
  it("fails the active jobs of a dead process, clears its « en cours » and queues those imports again", async () => {
    const hourAgo = new Date(Date.now() - 3_600_000);
    const figures = { lastImportSeen: 40, lastImportCreated: 4, lastImportRemoved: 1 };
    // A: killed mid-import (SIGKILL): its job still active, its state still running.
    const a = await newShop({
      importState: "running",
      importStartedAt: hourAgo,
      importHeartbeatAt: hourAgo,
      ...figures,
    });
    // B: state left running, its job already settled (pg-boss failed it at a stop that closed the pool first).
    const b = await newShop({ importState: "running", importStartedAt: hourAgo });
    // C: stopped cleanly by a deploy: no state, the interruption recorded.
    const c = await newShop({ lastImportError: "interrupted", ...figures });
    // D: running when the process died, merged since: cleared, not queued.
    const d = await newShop({ importState: "running", importStartedAt: hourAgo, mergedIntoId: c.id });
    // E: waiting in the queue: untouched (its job is still there).
    const e = await newShop({ importState: "queued", importStartedAt: hourAgo });

    const dead = await newBoss();
    await dead.send(CATALOGUE_IMPORT_QUEUE, { shopId: a.id }, { singletonKey: a.id });
    const [claimed] = await dead.fetch(CATALOGUE_IMPORT_QUEUE);
    expect(claimed?.data).toEqual({ shopId: a.id });
    await dead.send(CATALOGUE_IMPORT_QUEUE, { shopId: e.id }, { singletonKey: e.id });
    // The process dies: nothing settles the fetched job.
    await dead.stop({ graceful: false, timeout: 1000 });
    const boss = await newBoss();
    expect(await states(boss, a.id)).toEqual(["active"]);
    // The shop is blocked meanwhile: the same singleton key cannot be queued.
    expect(await boss.send(CATALOGUE_IMPORT_QUEUE, { shopId: a.id }, { singletonKey: a.id })).toBeNull();

    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await recoverInterruptedImports(handle.db, boss);
    log.mockRestore();

    expect(result.failed).toBe(1);
    expect(new Set(result.requeued)).toEqual(new Set([a.id, b.id, c.id]));
    expect(await states(boss, a.id)).toEqual(["created", "failed"]);
    expect(await states(boss, b.id)).toEqual(["created"]);
    expect(await states(boss, c.id)).toEqual(["created"]);
    expect(await states(boss, d.id)).toEqual([]);
    expect(await states(boss, e.id)).toEqual(["created"]);
    for (const shop of [a, b, c]) {
      expect(await shopRow(shop.id)).toMatchObject({ importState: "queued" });
    }
    // The figures of the last complete import stay.
    expect(await shopRow(a.id)).toMatchObject(figures);
    expect(await shopRow(c.id)).toMatchObject(figures);
    expect(await shopRow(d.id)).toMatchObject({ importState: null });
    expect(await shopRow(e.id)).toMatchObject({ importState: "queued", importStartedAt: hourAgo });

    // Run again (a second restart): nothing more to do, nothing queued twice.
    const again = await recoverInterruptedImports(handle.db, boss);
    expect(again.failed).toBe(0);
    expect(await states(boss, a.id)).toEqual(["created", "failed"]);
    expect(await states(boss, c.id)).toEqual(["created"]);
  });

  it("resumes a shop with the nightly import off (or a « grande enseigne ») only when the admin launched it by hand", async () => {
    const hourAgo = new Date(Date.now() - 3_600_000);
    const off = { importEnabled: false };
    // F: « Importer maintenant » on a shop without the nightly import, killed mid-import.
    const f = await newShop({ ...off, importState: "running", importStartedAt: hourAgo });
    // G: a nightly import, cut cleanly, then the admin turned the nightly import off: not resumed.
    const g = await newShop({ ...off, lastImportError: "interrupted" });
    // H: « Importer maintenant », cut cleanly: resumed.
    const h = await newShop({ ...off, lastImportError: "interrupted" });
    // I: left running, but a job of it already waits: nothing new is queued, it stays « En attente ».
    const i = await newShop({ importState: "running", importStartedAt: hourAgo });
    // J: a « grande enseigne » with the nightly import on, cut cleanly: the planner never imports it, nor this.
    const j = await newShop({ isMajorBrand: true, lastImportError: "interrupted" });

    const dead = await newBoss();
    // Only this test's jobs: each fetch below takes the job just sent.
    await dead.deleteQueuedJobs(CATALOGUE_IMPORT_QUEUE);
    const settled = async (shopId: string, manual: boolean) => {
      await dead.send(CATALOGUE_IMPORT_QUEUE, { shopId, ...(manual ? { manual } : {}) }, { singletonKey: shopId });
      const [job] = await dead.fetch(CATALOGUE_IMPORT_QUEUE);
      if (job) await dead.complete(CATALOGUE_IMPORT_QUEUE, job.id);
    };
    await settled(g.id, false);
    await settled(h.id, true);
    await settled(j.id, false);
    await dead.send(CATALOGUE_IMPORT_QUEUE, { shopId: f.id, manual: true }, { singletonKey: f.id });
    await dead.fetch(CATALOGUE_IMPORT_QUEUE);
    await dead.send(CATALOGUE_IMPORT_QUEUE, { shopId: i.id }, { singletonKey: i.id });
    await dead.stop({ graceful: false, timeout: 1000 });
    const boss = await newBoss();

    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await recoverInterruptedImports(handle.db, boss);
    log.mockRestore();

    expect(new Set(result.requeued)).toEqual(new Set([f.id, h.id]));
    const created = async (shopId: string) =>
      (await jobsOf(boss, shopId)).filter((j) => j.state === "created").map((j) => j.data);
    // Still marked as asked by the admin, for a later restart.
    expect(await created(f.id)).toEqual([{ shopId: f.id, manual: true }]);
    expect(await created(h.id)).toEqual([{ shopId: h.id, manual: true }]);
    expect(await created(g.id)).toEqual([]);
    expect(await shopRow(g.id)).toMatchObject({ importState: null });
    expect(await created(i.id)).toEqual([{ shopId: i.id }]);
    expect(await created(j.id)).toEqual([]);
    expect(await shopRow(j.id)).toMatchObject({ importState: null });
    expect(await shopRow(i.id)).toMatchObject({ importState: "queued" });
  });
});

describe("graceful stop (deploy)", () => {
  let shop: FakeShop;
  afterEach(async () => {
    await shop?.close();
  });

  const loopbackOnly: AddressPolicy = Object.assign(
    (ip: string): boolean => ip === "127.0.0.1" && loopbackForTests(ip),
    { anyPortOnLoopback: true as const },
  );
  const noDns = ((host: string, _options: unknown, callback: (error: Error | null, addresses: never[]) => void) => {
    callback(Object.assign(new Error(`no DNS in tests: ${host}`), { code: "ENOTFOUND" }), []);
  }) as unknown as typeof dns.lookup;

  it("stops an import under way between two requests, clears its state, settles its job; the next start resumes it", async () => {
    const product = (id: number) => ({
      id,
      title: `Article ${id}`,
      handle: `article-${id}`,
      options: [{ name: "Taille", values: ["S"] }],
      variants: [{ id: id * 10, option1: "S", available: true, price: "10.00" }],
      images: [],
    });
    const routes: Record<string, FakeRoute> = {
      "/products.json?limit=250&page=1": {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ products: Array.from({ length: 250 }, (_, i) => product(5000 + i)) }),
      },
      "/products.json?limit=250&page=2": {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ products: [product(6000)] }),
        delayMs: 5000,
      },
    };
    shop = await startFakeShop(routes);
    const s = await newShop({ testUrl: `${shop.origin}/products/x`, lastImportSeen: 40 });

    const boss = await newBoss();
    // Only this test's import in the queue (the previous test left jobs for shops that do not exist on the network).
    await boss.deleteQueuedJobs(CATALOGUE_IMPORT_QUEUE);
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    await registerCaptureQueues(boss, {
      db: handle.db,
      store: memoryStore(),
      policy: loopbackOnly,
      lookup: noDns,
      throttle: { wait: async () => {} },
    });
    const jobId = await boss.send(CATALOGUE_IMPORT_QUEUE, { shopId: s.id }, { singletonKey: s.id });
    // Wait until page 1 is in: the import is between two requests (or reading page 2, which answers in 5 s).
    await vi.waitFor(
      async () => {
        expect((await shopRow(s.id))?.importPages).toBe(1);
      },
      { timeout: 20_000, interval: 50 },
    );
    expect((await shopRow(s.id))?.importState).toBe("running");

    const stoppedAt = Date.now();
    await stopWorker(boss, { timeoutMs: 10_000 });
    // Well within systemd's 20 s, without waiting for page 2.
    expect(Date.now() - stoppedAt).toBeLessThan(4000);
    info.mockRestore();

    expect(await shopRow(s.id)).toMatchObject({
      importState: null,
      lastImportError: "interrupted",
      lastImportSeen: 40,
    });
    const next = await newBoss();
    const [job] = await next.findJobs(CATALOGUE_IMPORT_QUEUE, { id: jobId ?? "" });
    expect(job?.state).not.toBe("active");
    expect(job?.state).not.toBe("created");

    // The next start queues it again.
    const result = await recoverInterruptedImports(handle.db, next);
    expect(result.requeued).toEqual([s.id]);
    expect(await states(next, s.id)).toContain("created");
    expect((await shopRow(s.id))?.importState).toBe("queued");
  }, 60_000);
});
