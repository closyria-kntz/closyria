import { createDb, eq, schema } from "@closyria/db";
import { AI_MONTHLY_CAP_SETTING } from "@closyria/shared";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { aiMonth, callCostNanoUsd, databaseBudget, NANO_USD_PER_EURO_CENT, readAiMonthlyCapCents } from "./budget";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let handle: ReturnType<typeof createDb>;

beforeAll(async () => {
  database = await createTestDatabase();
  handle = createDb(database.url, { max: 8 });
}, 60_000);

afterAll(async () => {
  await handle?.pool.end();
  await database?.stop();
});

beforeEach(async () => {
  await handle.db.delete(schema.aiUsageMonths);
  await handle.db.delete(schema.appSettings);
});

const at = new Date("2026-11-30T23:30:00Z"); // already December in Paris
const month = async () =>
  (await handle.db.select().from(schema.aiUsageMonths).where(eq(schema.aiUsageMonths.month, "2026-12")))[0];

describe("callCostNanoUsd", () => {
  it("prices Haiku 5.5 tokens, the dearer tier past 100 000 prompt tokens", () => {
    expect(callCostNanoUsd({ input_tokens: 10_000, output_tokens: 1_000 })).toBe(1_500_000);
    expect(callCostNanoUsd({ input_tokens: 100_001, output_tokens: 0 })).toBe(50_000_500);
    expect(
      callCostNanoUsd({
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 10,
      }),
    ).toBe(1_350);
  });
});

describe("databaseBudget", () => {
  it("counts in the Paris month and settles to the real cost", async () => {
    expect(aiMonth(at)).toBe("2026-12");
    const budget = databaseBudget(handle.db, () => at);
    const reservation = await budget.reserve(4_000_000);
    expect((await month())?.costNanoUsd).toBe(4_000_000);
    await reservation?.settle(270_000);
    await reservation?.settle(999_999_999); // once only
    expect(await month()).toMatchObject({ costNanoUsd: 270_000, calls: 1 });
  });

  it("refuses a call that would pass the cap (10 € by default), the admin's cap otherwise", async () => {
    expect(await readAiMonthlyCapCents(handle.db)).toBe(1000);
    const budget = databaseBudget(handle.db, () => at);
    const capNano = 1000 * NANO_USD_PER_EURO_CENT;
    expect(await budget.reserve(capNano + 1)).toBeNull();
    expect(await month()).toBeUndefined();
    expect(await budget.reserve(capNano - 10)).not.toBeNull();
    expect(await budget.reserve(11)).toBeNull();
    expect(await budget.reserve(10)).not.toBeNull();

    await handle.db.insert(schema.appSettings).values({ key: AI_MONTHLY_CAP_SETTING, value: 2000 });
    expect(await readAiMonthlyCapCents(handle.db)).toBe(2000);
    expect(await budget.reserve(capNano)).not.toBeNull();
    // A broken setting falls back to the default.
    await handle.db.update(schema.appSettings).set({ value: "beaucoup" });
    expect(await readAiMonthlyCapCents(handle.db)).toBe(1000);
  });

  it("never lets calls at the same time pass the cap together", async () => {
    await handle.db.insert(schema.appSettings).values({ key: AI_MONTHLY_CAP_SETTING, value: 1 });
    const budget = databaseBudget(handle.db, () => at);
    const share = NANO_USD_PER_EURO_CENT / 4; // 1 cent holds four of them
    const results = await Promise.all(Array.from({ length: 8 }, () => budget.reserve(share)));
    expect(results.filter((r) => r !== null)).toHaveLength(4);
    expect(await month()).toMatchObject({ costNanoUsd: NANO_USD_PER_EURO_CENT, calls: 4 });
  });
});
