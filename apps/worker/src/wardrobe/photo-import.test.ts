import type dns from "node:dns";
import { createDb, eq, schema } from "@closyria/db";
import { memoryStore, type ObjectStore } from "@closyria/storage";
import { type FakeRoute, type FakeShop, startFakeShop } from "@closyria/testing";
import { createTestDatabase } from "@closyria/testing/vitest";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AddressPolicy } from "../capture/address-policy";
import { loopbackForTests } from "../capture/testing";
import { type PhotoImportDeps, runPhotoImport } from "./photo-import";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let handle: ReturnType<typeof createDb>;
let shop: FakeShop;
let routes: Record<string, FakeRoute>;
let store: ObjectStore;
/** Keys currently in the store. */
let live: Set<string>;
let deps: PhotoImportDeps;
let counter = 0;

/** Loopback only: the fake shop on 127.0.0.1, nothing else. */
const loopbackOnly: AddressPolicy = Object.assign((ip: string): boolean => ip === "127.0.0.1" && loopbackForTests(ip), {
  anyPortOnLoopback: true as const,
});

/** No DNS in tests: every hostname fails (the fake shop is an IP literal). */
const noDns = ((host: string, _options: unknown, callback: (error: Error | null, addresses: never[]) => void) => {
  callback(Object.assign(new Error(`no DNS in tests: ${host}`), { code: "ENOTFOUND" }), []);
}) as unknown as typeof dns.lookup;

beforeAll(async () => {
  database = await createTestDatabase();
  handle = createDb(database.url, { max: 4 });
}, 60_000);

afterAll(async () => {
  await handle?.pool.end();
  await database?.stop();
});

beforeEach(async () => {
  routes = {};
  shop = await startFakeShop(routes);
  const inner = memoryStore();
  live = new Set();
  store = {
    ...inner,
    async put(key, body, contentType) {
      await inner.put(key, body, contentType);
      live.add(key);
    },
    async delete(key) {
      await inner.delete(key);
      live.delete(key);
    },
  };
  deps = { db: handle.db, store, policy: loopbackOnly, lookup: noDns };
});

afterEach(async () => {
  await shop.close();
});

async function newImport(url: string) {
  const { db } = handle;
  const n = ++counter;
  const userId = `photo-import-user-${n}`;
  await db.insert(schema.user).values({ id: userId, name: userId, email: `${userId}@example.test` });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ userId, name: "Moi", audience: "women", color: "plum" })
    .returning();
  const [item] = await db
    .insert(schema.items)
    .values({ userId, profileId: profile?.id as string })
    .returning();
  const [row] = await db
    .insert(schema.photoImports)
    .values({ userId, itemId: item?.id as string, url })
    .returning();
  return { userId, importId: row?.id as string };
}

async function importRow(id: string) {
  const [row] = await handle.db.select().from(schema.photoImports).where(eq(schema.photoImports.id, id));
  return row;
}

const png = () =>
  sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 200, g: 40, b: 90 } } })
    .png()
    .toBuffer();

describe("runPhotoImport", () => {
  it("downloads a PNG, stores it as WebP under her folder and marks the import ready", async () => {
    routes["/photo.png"] = { headers: { "content-type": "image/png" }, body: await png() };
    const { userId, importId } = await newImport(`${shop.origin}/photo.png`);
    await runPhotoImport(importId, deps);
    const row = await importRow(importId);
    expect(row).toMatchObject({ status: "ready", errorCode: null, contentType: "image/webp", width: 300, height: 200 });
    expect(row?.mediaKey).toMatch(new RegExp(`^users/${userId}/[0-9a-f-]{36}\\.webp$`));
    const stored = await store.get(row?.mediaKey ?? "");
    expect(row?.sizeBytes).toBe(stored.length);
    expect((await sharp(stored).metadata()).format).toBe("webp");
    expect(row?.updatedAt.getTime()).toBeGreaterThanOrEqual(row?.createdAt.getTime() ?? 0);
  });

  it("refuses a private address: failed/blocked, nothing stored", async () => {
    const { importId } = await newImport("http://10.0.0.1/photo.png");
    await runPhotoImport(importId, deps);
    expect(await importRow(importId)).toMatchObject({ status: "failed", errorCode: "blocked", mediaKey: null });
    expect([...live]).toEqual([]);
  });

  it("an HTTP error answer is blocked", async () => {
    const { importId } = await newImport(`${shop.origin}/missing.png`);
    await runPhotoImport(importId, deps);
    expect(await importRow(importId)).toMatchObject({ status: "failed", errorCode: "blocked" });
  });

  it("an HTML page is unsupported", async () => {
    routes["/page"] = { headers: { "content-type": "text/html" }, body: "<html><body>Robe</body></html>" };
    const { importId } = await newImport(`${shop.origin}/page`);
    await runPhotoImport(importId, deps);
    expect(await importRow(importId)).toMatchObject({ status: "failed", errorCode: "unsupported", mediaKey: null });
    expect([...live]).toEqual([]);
  });

  it("an image type whose content is not an image is unsupported", async () => {
    routes["/fake.png"] = { headers: { "content-type": "image/png" }, body: "not an image" };
    const { importId } = await newImport(`${shop.origin}/fake.png`);
    await runPhotoImport(importId, deps);
    expect(await importRow(importId)).toMatchObject({ status: "failed", errorCode: "unsupported" });
  });

  it("a 21 MB body is too_large, nothing stored", async () => {
    routes["/huge.png"] = { headers: { "content-type": "image/png" }, body: Buffer.alloc(21 * 1024 * 1024) };
    const { importId } = await newImport(`${shop.origin}/huge.png`);
    await runPhotoImport(importId, deps);
    expect(await importRow(importId)).toMatchObject({ status: "failed", errorCode: "too_large", mediaKey: null });
    expect([...live]).toEqual([]);
  });

  it("a slow answer is a timeout", async () => {
    routes["/slow.png"] = { headers: { "content-type": "image/png" }, body: await png(), delayMs: 2_000 };
    const { importId } = await newImport(`${shop.origin}/slow.png`);
    await runPhotoImport(importId, { ...deps, timeoutMs: 200 });
    expect(await importRow(importId)).toMatchObject({ status: "failed", errorCode: "timeout" });
  });

  it("does nothing for an import that is no longer queued or no longer exists", async () => {
    routes["/photo.png"] = { headers: { "content-type": "image/png" }, body: await png() };
    const { importId } = await newImport(`${shop.origin}/photo.png`);
    await handle.db
      .update(schema.photoImports)
      .set({ status: "failed", errorCode: "failed" })
      .where(eq(schema.photoImports.id, importId));
    await runPhotoImport(importId, deps);
    await runPhotoImport("7b1f6a52-3a0b-4a4c-9f0e-5b1c2d3e4f50", deps);
    expect(await importRow(importId)).toMatchObject({ status: "failed", errorCode: "failed" });
    expect(shop.hits).toEqual([]);
  });
});
