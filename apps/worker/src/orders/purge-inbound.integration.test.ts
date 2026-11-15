import { createDb, eq, inArray, schema } from "@closyria/db";
import { INBOUND_EMAIL_RETENTION_DAYS, ORDER_EMAIL_PARSE_QUEUE, rawEmailKey } from "@closyria/shared";
import { memoryStore, type ObjectStore } from "@closyria/storage";
import { createTestDatabase } from "@closyria/testing/vitest";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { purgeInboundEmails } from "./purge-inbound";
import { ORDER_EMAIL_PURGE_QUEUE, orderEmailPurgeHandler, registerOrderQueues } from "./queues";

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

const now = new Date("2026-11-14T03:45:00Z");
const DAY_MS = 86_400_000;

async function setup() {
  const { db } = handle;
  const n = ++counter;
  const userId = `inbound-purge-user-${n}`;
  await db.insert(schema.user).values({ id: userId, name: userId, email: `${userId}@example.test` });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ userId, name: "Moi", audience: "women", color: "plum" })
    .returning();
  const [inbox] = await db
    .insert(schema.orderInboxes)
    .values({ userId, localPart: `purge-${n}` })
    .returning();
  return { userId, profileId: profile?.id as string, inboxId: inbox?.id as string };
}

const stored = async (store: ObjectStore, key: string) => {
  try {
    await store.get(key);
    return true;
  } catch {
    return false;
  }
};

describe("purgeInboundEmails", () => {
  it("applies the rule 30 days after reception: deletes ignored and unread ones, erases the others' raw message", async () => {
    const { db } = handle;
    const store = memoryStore();
    const ctx = await setup();
    // Received 31 days ago: past its purge date. Received 29 days ago: kept as is.
    const receivedAt = new Date(now.getTime() - 31 * DAY_MS);
    const purgeAfter = new Date(receivedAt.getTime() + INBOUND_EMAIL_RETENTION_DAYS * DAY_MS);
    const freshReceived = new Date(now.getTime() - 29 * DAY_MS);
    const email = async (status: string, withRaw: boolean, fresh = false) => {
      const r = fresh ? freshReceived : receivedAt;
      const [row] = await db
        .insert(schema.inboundEmails)
        .values({
          inboxId: ctx.inboxId,
          userId: status === "ignored" ? null : ctx.userId,
          queueId: `Q${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
          fromAddress: "marie@example.test",
          authOk: status !== "ignored",
          status,
          receivedAt: r,
          purgeAfter: new Date(r.getTime() + INBOUND_EMAIL_RETENTION_DAYS * DAY_MS),
        })
        .returning();
      const id = row?.id as string;
      if (withRaw) {
        const key = `users/${ctx.userId}/inbound/${id}.eml`;
        await store.put(key, Buffer.from("raw"), "message/rfc822");
        await db.update(schema.inboundEmails).set({ rawObjectKey: key }).where(eq(schema.inboundEmails.id, id));
      }
      return { id, key: `users/${ctx.userId}/inbound/${id}.eml` };
    };
    expect(purgeAfter.getTime()).toBeLessThan(now.getTime());
    const ignored = await email("ignored", false);
    const failedAlone = await email("failed", true);
    const failedWithOrder = await email("failed", true);
    const parsed = await email("parsed", true);
    const queued = await email("queued", true);
    const fresh = await email("parsed", true, true);
    await db.insert(schema.orders).values({
      userId: ctx.userId,
      profileId: ctx.profileId,
      source: "manual",
      parseMethod: "manual",
      inboundEmailId: failedWithOrder.id,
    });

    expect(await purgeInboundEmails(db, now, store)).toEqual({ deleted: 2, cleared: 3, failed: 0, codes: 0 });

    const all = [ignored, failedAlone, failedWithOrder, parsed, queued, fresh];
    const rows = await db
      .select({ id: schema.inboundEmails.id, key: schema.inboundEmails.rawObjectKey })
      .from(schema.inboundEmails)
      .where(
        inArray(
          schema.inboundEmails.id,
          all.map((e) => e.id),
        ),
      );
    const byId = new Map(rows.map((r) => [r.id, r.key]));
    expect(byId.has(ignored.id)).toBe(false);
    expect(byId.has(failedAlone.id)).toBe(false);
    expect(byId.get(failedWithOrder.id)).toBeNull();
    expect(byId.get(parsed.id)).toBeNull();
    expect(byId.get(queued.id)).toBeNull();
    expect(byId.get(fresh.id)).toBe(fresh.key);
    for (const gone of [failedAlone, failedWithOrder, parsed, queued])
      expect(await stored(store, gone.key)).toBe(false);
    expect(await stored(store, fresh.key)).toBe(true);

    // Nothing left to do: a second run changes nothing.
    expect(await purgeInboundEmails(db, now, store)).toEqual({ deleted: 0, cleared: 0, failed: 0, codes: 0 });
  });

  it("keeps the key while the object is not deleted (logged), for the next run", async () => {
    const { db } = handle;
    const ctx = await setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: ObjectStore = {
      put: async () => {},
      get: async () => Buffer.from(""),
      delete: async () => {
        throw new Error("down");
      },
    };
    const r = new Date(now.getTime() - 40 * DAY_MS);
    const [row] = await db
      .insert(schema.inboundEmails)
      .values({
        inboxId: ctx.inboxId,
        userId: ctx.userId,
        queueId: `Q${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
        fromAddress: "marie@example.test",
        authOk: true,
        status: "parsed",
        rawObjectKey: `users/${ctx.userId}/inbound/x.eml`,
        receivedAt: r,
        purgeAfter: new Date(r.getTime() + 30 * DAY_MS),
      })
      .returning();
    expect(await purgeInboundEmails(db, now, failing)).toEqual({ deleted: 0, cleared: 0, failed: 0, codes: 0 });
    expect(error).toHaveBeenCalledTimes(1);
    const [kept] = await db
      .select()
      .from(schema.inboundEmails)
      .where(eq(schema.inboundEmails.id, row?.id as string));
    expect(kept?.rawObjectKey).toBe(`users/${ctx.userId}/inbound/x.eml`);
    // The store is back: the next run finishes it.
    expect(await purgeInboundEmails(db, now, memoryStore())).toEqual({ deleted: 0, cleared: 1, failed: 0, codes: 0 });
    expect(String(error.mock.calls[0])).not.toContain(ctx.userId);
    error.mockRestore();
  });
});

describe("purgeInboundEmails: what the reception left half done", () => {
  it("fails an accepted e-mail still queued without its message after an hour, its object deleted first", async () => {
    const { db } = handle;
    const store = memoryStore();
    const ctx = await setup();
    const row = async (minutesAgo: number, status = "queued") => {
      const r = new Date(now.getTime() - minutesAgo * 60_000);
      const [inserted] = await db
        .insert(schema.inboundEmails)
        .values({
          inboxId: ctx.inboxId,
          userId: ctx.userId,
          queueId: `Q${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
          fromAddress: "marie@example.test",
          authOk: true,
          status,
          receivedAt: r,
          purgeAfter: new Date(r.getTime() + 30 * DAY_MS),
        })
        .returning();
      return inserted?.id as string;
    };
    const stuck = await row(61);
    const recent = await row(59);
    // Its object landed but the key was never saved: deleted with it.
    const orphan = rawEmailKey(ctx.userId, stuck);
    await store.put(orphan, Buffer.from("raw"), "message/rfc822");
    expect(await purgeInboundEmails(db, now, store)).toEqual({ deleted: 0, cleared: 0, failed: 1, codes: 0 });
    const statuses = await db
      .select({ id: schema.inboundEmails.id, status: schema.inboundEmails.status })
      .from(schema.inboundEmails)
      .where(inArray(schema.inboundEmails.id, [stuck, recent]));
    expect(new Map(statuses.map((s) => [s.id, s.status]))).toEqual(
      new Map([
        [stuck, "failed"],
        [recent, "queued"],
      ]),
    );
    expect(await stored(store, orphan)).toBe(false);
  });
});

describe("purgeInboundEmails: Gmail confirmation codes", () => {
  it("erases a code after 24 hours, keeps a fresher one", async () => {
    const { db } = handle;
    const old = await setup();
    const fresh = await setup();
    await db
      .update(schema.orderInboxes)
      .set({ gmailCode: "185412963", gmailCodeAt: new Date(now.getTime() - 24 * 3_600_000 - 1) })
      .where(eq(schema.orderInboxes.id, old.inboxId));
    await db
      .update(schema.orderInboxes)
      .set({ gmailCode: "185412964", gmailCodeAt: new Date(now.getTime() - 23 * 3_600_000) })
      .where(eq(schema.orderInboxes.id, fresh.inboxId));
    expect((await purgeInboundEmails(db, now, memoryStore())).codes).toBe(1);
    const rows = await db
      .select({ id: schema.orderInboxes.id, code: schema.orderInboxes.gmailCode, at: schema.orderInboxes.gmailCodeAt })
      .from(schema.orderInboxes)
      .where(inArray(schema.orderInboxes.id, [old.inboxId, fresh.inboxId]));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(old.inboxId)).toMatchObject({ code: null, at: null });
    expect(byId.get(fresh.inboxId)?.code).toBe("185412964");
  });
});

describe("order-email-purge queue", () => {
  it("is created, processed and scheduled every night; order-email-parse is worked with its retries", async () => {
    const calls: unknown[][] = [];
    const boss = {
      createQueue: vi.fn(async () => {}),
      updateQueue: vi.fn(async () => {}),
      work: vi.fn(async () => "id"),
      schedule: vi.fn(async (...args: unknown[]) => {
        calls.push(args);
      }),
    } as unknown as PgBoss;
    await registerOrderQueues(boss, { db: handle.db, store: memoryStore() });
    expect(boss.createQueue).toHaveBeenCalledWith(ORDER_EMAIL_PURGE_QUEUE);
    expect(boss.work).toHaveBeenCalledWith(ORDER_EMAIL_PURGE_QUEUE, expect.any(Function));
    expect(calls).toEqual([["order-email-purge", "45 3 * * *"]]);
    const retries = { retryLimit: 3, retryDelay: 60, retryBackoff: true };
    expect(boss.createQueue).toHaveBeenCalledWith(ORDER_EMAIL_PARSE_QUEUE, retries);
    expect(boss.updateQueue).toHaveBeenCalledWith(ORDER_EMAIL_PARSE_QUEUE, retries);
    expect(boss.work).toHaveBeenCalledWith(ORDER_EMAIL_PARSE_QUEUE, { includeMetadata: true }, expect.any(Function));
  });

  it("fails a job that carries data", async () => {
    const run = vi.fn(async () => ({ deleted: 0, cleared: 0, failed: 0, codes: 0 }));
    const handler = orderEmailPurgeHandler(run);
    await handler([{ data: undefined }, { data: {} }]);
    expect(run).toHaveBeenCalledTimes(2);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(handler([{ id: "j", data: { x: 1 } }])).rejects.toThrow("invalid job data");
    error.mockRestore();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
