import { createDb, eq, schema } from "@closyria/db";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { purgeAlerts } from "./purge";

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

const now = new Date("2026-11-14T03:30:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

describe("purgeAlerts", () => {
  it("deletes alerts over 35 days unless still waiting, and sends over 30 days", async () => {
    const { db } = handle;
    const userId = "alerts-purge-user";
    await db.insert(schema.user).values({ id: userId, name: userId, email: `${userId}@example.test` });
    const [sale] = await db
      .insert(schema.salePeriods)
      .values({ name: "Soldes", startsOn: "2026-06-24", endsOn: "2026-07-21" })
      .returning();
    const event = (status: string, days: number) => ({
      userId,
      kind: "sale_period",
      salePeriodId: sale?.id,
      status,
      createdAt: daysAgo(days),
    });
    const rows = await db
      .insert(schema.alertEvents)
      .values([event("sent", 36), event("skipped", 40), event("pending", 40), event("digest", 40), event("sent", 34)])
      .returning({ id: schema.alertEvents.id });
    await db.insert(schema.alertSends).values([
      { userId, ok: true, sentAt: daysAgo(31) },
      { userId, ok: false, sentAt: daysAgo(29) },
    ]);

    expect(await purgeAlerts(db, now)).toEqual({ events: 2, sends: 1 });
    const left = await db
      .select({ id: schema.alertEvents.id })
      .from(schema.alertEvents)
      .where(eq(schema.alertEvents.userId, userId));
    expect(left.map((r) => r.id).sort()).toEqual(
      rows
        .slice(2)
        .map((r) => r.id)
        .sort(),
    );
    const sends = await db.select().from(schema.alertSends).where(eq(schema.alertSends.userId, userId));
    expect(sends.map((s) => s.ok)).toEqual([false]);

    expect(await purgeAlerts(db, now)).toEqual({ events: 0, sends: 0 });
  });
});
