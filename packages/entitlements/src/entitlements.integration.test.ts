import { listOwnedColumns, reassignUserData } from "@closyria/auth";
import { createDb, schema } from "@closyria/db";
import type { TestDatabase } from "@closyria/testing";
import { createTestDatabase } from "@closyria/testing/vitest";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEntitlements, DEFAULT_PLAN_ID, entitlementKeys, registerEntitlementsOwnedTables } from "./index";

let database: TestDatabase;
let handle: ReturnType<typeof createDb>;
let counter = 0;

const JANUARY = () => new Date("2027-01-15T12:00:00Z");
const FEBRUARY = () => new Date("2027-02-01T00:00:00Z");
/** Every plan fixture starts before the injected clock: the column default (real now()) would not. */
const PLAN_START = new Date("2027-01-01T00:00:00Z");

async function newUser(): Promise<string> {
  const id = `user-${++counter}`;
  await handle.db.insert(schema.user).values({ id, name: id, email: `${id}@example.test` });
  return id;
}

const ent = (now: () => Date = JANUARY) => createEntitlements({ db: handle.db, now });

/** A plan of its own, so no test depends on another's fixtures. */
async function newPlan(
  entitlements: { key: (typeof entitlementKeys)[number]; limitValue: number | null; enabled?: boolean }[] = [],
): Promise<string> {
  const id = `plan-${++counter}`;
  await handle.db.insert(schema.plans).values({ id, name: id });
  if (entitlements.length > 0) {
    await handle.db.insert(schema.planEntitlements).values(entitlements.map((e) => ({ planId: id, ...e })));
  }
  return id;
}

beforeAll(async () => {
  database = await createTestDatabase();
  handle = createDb(database.url, { max: 30 });
  registerEntitlementsOwnedTables();
}, 60_000);

afterAll(async () => {
  await handle?.pool.end();
  await database?.stop();
});

describe("plans", () => {
  it("gives a user without a plan the default « Gratuit » plan", async () => {
    const u = await newUser();
    expect(DEFAULT_PLAN_ID).toBe("free");
    const [plan] = await handle.db.select().from(schema.plans).where(eq(schema.plans.id, DEFAULT_PLAN_ID));
    expect(plan?.name).toBe("Gratuit");
    expect(await ent().getLimit(u, "wardrobe_items")).toBe(300);
    expect(await ent().getLimit(u, "active_alerts")).toBe(50);
    for (const key of ["cutouts_per_month", "order_emails_per_month", "ai_calls_per_month"] as const) {
      expect(await ent().getLimit(u, key)).toBe(20);
    }
  });

  it("uses the user's own plan while it runs, and falls back to « Gratuit » once it ended", async () => {
    const pro = await newPlan([
      { key: "cutouts_per_month", limitValue: 500 },
      { key: "ai_calls_per_month", limitValue: null },
      { key: "active_alerts", limitValue: 10, enabled: false },
    ]);
    const u = await newUser();
    await handle.db.insert(schema.userPlans).values({
      userId: u,
      planId: pro,
      startsAt: PLAN_START,
      source: "gift",
      endsAt: new Date("2027-02-01T00:00:00Z"),
    });
    expect(await ent().getLimit(u, "cutouts_per_month")).toBe(500);
    expect(await ent().getLimit(u, "ai_calls_per_month")).toBe("unlimited");
    expect(await ent().getLimit(u, "active_alerts")).toBe(0); // disabled
    expect(await ent().getLimit(u, "wardrobe_items")).toBe(0); // no row: not allowed
    expect(await ent(FEBRUARY).getLimit(u, "cutouts_per_month")).toBe(20);
  });

  it("keeps the key list closed", () => {
    expect([...entitlementKeys]).toEqual([
      "wardrobe_items",
      "active_alerts",
      "cutouts_per_month",
      "order_emails_per_month",
      "ai_calls_per_month",
    ]);
  });
});

describe("checkAndConsume", () => {
  it("accepts 20 calls and refuses the 21st", async () => {
    const u = await newUser();
    for (let i = 1; i <= 20; i++) {
      const r = await ent().checkAndConsume(u, "cutouts_per_month");
      expect(r, `call ${i}`).toEqual({ allowed: true, remaining: 20 - i });
    }
    expect(await ent().checkAndConsume(u, "cutouts_per_month")).toEqual({ allowed: false, remaining: 0 });
  });

  it("accepts only 20 of 25 simultaneous calls", async () => {
    const u = await newUser();
    const results = await Promise.all(Array.from({ length: 25 }, () => ent().checkAndConsume(u, "cutouts_per_month")));
    expect(results.filter((r) => r.allowed)).toHaveLength(20);
    const [row] = await handle.db.select().from(schema.usageCounters).where(eq(schema.usageCounters.userId, u));
    expect(row?.value).toBe(20);
  });

  it("refuses an amount that does not fit without consuming anything", async () => {
    const u = await newUser();
    expect(await ent().checkAndConsume(u, "ai_calls_per_month", 15)).toEqual({ allowed: true, remaining: 5 });
    expect(await ent().checkAndConsume(u, "ai_calls_per_month", 6)).toEqual({ allowed: false, remaining: 5 });
    expect(await ent().checkAndConsume(u, "ai_calls_per_month", 5)).toEqual({ allowed: true, remaining: 0 });
  });

  it("refuses everything on a limit of 0 and never creates a counter", async () => {
    const u = await newUser();
    await handle.db.insert(schema.userPlans).values({ userId: u, planId: await newPlan(), startsAt: PLAN_START });
    expect(await ent().checkAndConsume(u, "order_emails_per_month")).toEqual({ allowed: false, remaining: 0 });
  });

  it("resets the counter on a new month (UTC)", async () => {
    const u = await newUser();
    const lastInstant = () => new Date("2027-01-31T23:59:59.999Z");
    for (let i = 0; i < 20; i++) await ent(lastInstant).checkAndConsume(u, "cutouts_per_month");
    expect((await ent(lastInstant).checkAndConsume(u, "cutouts_per_month")).allowed).toBe(false);
    expect(await ent(FEBRUARY).checkAndConsume(u, "cutouts_per_month")).toEqual({ allowed: true, remaining: 19 });
    const rows = await handle.db.select().from(schema.usageCounters).where(eq(schema.usageCounters.userId, u));
    expect(rows.map((r) => r.period).sort()).toEqual(["2027-01", "2027-02"]);
  });

  it("counts without limit on an unlimited plan", async () => {
    const max = await newPlan([{ key: "ai_calls_per_month", limitValue: null }]);
    const u = await newUser();
    await handle.db.insert(schema.userPlans).values({ userId: u, planId: max, startsAt: PLAN_START });
    for (let i = 0; i < 30; i++) {
      expect(await ent().checkAndConsume(u, "ai_calls_per_month")).toEqual({ allowed: true, remaining: "unlimited" });
    }
  });

  it("rejects invalid amounts and stock keys", async () => {
    const u = await newUser();
    await expect(ent().checkAndConsume(u, "cutouts_per_month", 0)).rejects.toThrow();
    await expect(ent().checkAndConsume(u, "cutouts_per_month", 1.5)).rejects.toThrow();
    // @ts-expect-error stock keys are not consumable
    await expect(ent().checkAndConsume(u, "wardrobe_items")).rejects.toThrow();
  });
});

describe("checkLimit (stock keys)", () => {
  it("compares the current count to the limit, without storing anything", async () => {
    const u = await newUser();
    expect(await ent().checkLimit(u, "active_alerts", 49)).toEqual({ allowed: true, remaining: 1 });
    expect(await ent().checkLimit(u, "active_alerts", 50)).toEqual({ allowed: false, remaining: 0 });
    expect(await ent().checkLimit(u, "active_alerts", 70)).toEqual({ allowed: false, remaining: 0 });
    const rows = await handle.db.select().from(schema.usageCounters).where(eq(schema.usageCounters.userId, u));
    expect(rows).toEqual([]);
  });
});

describe("account linking", () => {
  it("registers its user-owned tables with a cascading foreign key to user(id)", async () => {
    registerEntitlementsOwnedTables();
    const owned = listOwnedColumns().filter(({ table }) => ["user_plans", "usage_counters"].includes(table));
    expect(owned.map((o) => o.table).sort()).toEqual(["usage_counters", "user_plans"]);
    for (const { table, column } of owned) {
      const result = await handle.db.execute<{ n: number }>(sql`
        select count(*)::int as n
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        join pg_attribute r on r.attrelid = c.confrelid and r.attnum = c.confkey[1]
        where c.contype = 'f'
          and c.conrelid = ${table}::regclass
          and c.confrelid = '"user"'::regclass
          and cardinality(c.conkey) = 1
          and a.attname = ${column}
          and r.attname = 'id'
          and c.confdeltype = 'c'`);
      expect(result.rows[0]?.n, `${table}.${column}`).toBe(1);
    }
  });

  it("sums counters on a conflict and moves the others", async () => {
    const anonymous = await newUser();
    const account = await newUser();
    for (let i = 0; i < 3; i++) await ent().checkAndConsume(anonymous, "cutouts_per_month");
    for (let i = 0; i < 4; i++) await ent().checkAndConsume(account, "cutouts_per_month");
    await ent().checkAndConsume(anonymous, "ai_calls_per_month", 2);

    await handle.db.transaction((tx) => reassignUserData(anonymous, account, tx));

    const rows = await handle.db.select().from(schema.usageCounters).where(eq(schema.usageCounters.userId, account));
    expect(rows.map((r) => [r.key, r.value]).sort()).toEqual([
      ["ai_calls_per_month", 2],
      ["cutouts_per_month", 7],
    ]);
    const left = await handle.db.select().from(schema.usageCounters).where(eq(schema.usageCounters.userId, anonymous));
    expect(left).toEqual([]);
  });

  it("keeps the account's plan on a conflict, and moves the anonymous plan otherwise", async () => {
    const [gift, paid] = [await newPlan(), await newPlan()];
    const anonymous = await newUser();
    const account = await newUser();
    await handle.db.insert(schema.userPlans).values([
      { userId: anonymous, planId: gift, source: "gift", startsAt: PLAN_START },
      { userId: account, planId: paid, source: "stripe", startsAt: PLAN_START },
    ]);
    await handle.db.transaction((tx) => reassignUserData(anonymous, account, tx));
    const [kept] = await handle.db.select().from(schema.userPlans).where(eq(schema.userPlans.userId, account));
    expect(kept?.planId).toBe(paid);

    const anonymous2 = await newUser();
    const account2 = await newUser();
    await handle.db
      .insert(schema.userPlans)
      .values({ userId: anonymous2, planId: gift, source: "gift", startsAt: PLAN_START });
    await handle.db.transaction((tx) => reassignUserData(anonymous2, account2, tx));
    const [moved] = await handle.db.select().from(schema.userPlans).where(eq(schema.userPlans.userId, account2));
    expect(moved?.planId).toBe(gift);
  });
});
