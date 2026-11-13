import { createAuth, memoryMailer } from "@closyria/auth";
import { createDb, schema } from "@closyria/db";
import { CATALOGUE_IMPORT_QUEUE } from "@closyria/shared";
import { memoryStore, type ObjectStore } from "@closyria/storage";
import { createTestDatabase } from "@closyria/testing/vitest";
import { expect } from "vitest";
import { createApp } from "../app";
import type { CaptureQueue } from "./capture-queue";
import type { CatalogDeps } from "./deps";

export const BASE_URL = "http://localhost:3001";

/** A queue that only records what was enqueued (a catalogue import as `{ queue: "catalogue-import", id: shopId }`). */
export function recordingQueue() {
  const calls: { queue: string; id: string }[] = [];
  const queue: CaptureQueue = {
    async enqueue(name, id) {
      calls.push({ queue: name, id });
    },
    async importCatalogue(shopId) {
      calls.push({ queue: CATALOGUE_IMPORT_QUEUE, id: shopId });
      return true;
    },
    async refreshProduct(_productId, captureId) {
      calls.push({ queue: "capture-user", id: captureId });
      return true;
    },
  };
  return { queue, calls };
}

/** A migrated database, the app wired with a recording queue and an in-memory store. */
export async function createCatalogHarness(overrides: Partial<Omit<CatalogDeps, "db" | "store">> = {}) {
  const database = await createTestDatabase();
  const handle = createDb(database.url, { max: 8 });
  const auth = createAuth({
    db: handle.db,
    mailer: memoryMailer(),
    baseUrl: BASE_URL,
    secret: "test-secret-that-is-long-enough-0123456789",
  });
  const store: ObjectStore = memoryStore();
  const recorder = recordingQueue();
  const app = createApp({
    origin: BASE_URL,
    env: "test",
    version: "t",
    pingDb: async () => true,
    auth,
    media: { db: handle.db, store },
    events: { db: handle.db },
    // The same clock as the catalog routes, so the overview's 24 h / 7 day windows match fixed test dates.
    admin: { db: handle.db, ...(overrides.now ? { now: overrides.now } : {}) },
    wardrobe: { db: handle.db, shareLinkKey: Buffer.alloc(32, 7), ...(overrides.now ? { now: overrides.now } : {}) },
    catalog: { db: handle.db, store, queue: recorder.queue, ...overrides },
  });
  let ipCounter = 0;
  async function signIn() {
    const res = await auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-in/anonymous`, {
        method: "POST",
        headers: { origin: BASE_URL, "x-forwarded-for": `10.9.0.${++ipCounter}`, "user-agent": "closyria-tests" },
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
  async function stop() {
    await handle.pool.end();
    await database.stop();
  }
  return { ...handle, app, store, signIn, stop, ...recorder, schema };
}
