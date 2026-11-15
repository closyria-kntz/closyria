import { type Database, eq, schema, sql } from "@closyria/db";
import {
  AI_MONTHLY_CAP_SETTING,
  aiMonthlyCapCentsSchema,
  DEFAULT_AI_MONTHLY_CAP_CENTS,
  parisDay,
} from "@closyria/shared";

/**
 * Claude Haiku 5.5's prices (claude-api skill, cached 2026-11-03), in billionths of a dollar per token: $0.10 / $0.50
 * per million input / output tokens for a prompt up to 100 000 tokens, $0.50 / $2.50 beyond. A cache write is counted
 * at 2 times an input token (the 1-hour rate, the dearer one), a cache read 0.1 times (we cache nothing; counted anyway).
 */
export const MODEL_PRICES = {
  inputNano: 100,
  outputNano: 500,
  longInputNano: 500,
  longOutputNano: 2500,
  longPromptTokens: 100_000,
} as const;

/**
 * The cap is in euros, the bill in dollars: a dollar is counted as a euro. The dollar is worth less than the euro, so
 * this over-counts (the cap is reached a little early, never late).
 */
export const NANO_USD_PER_EURO_CENT = 10_000_000;

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

/** What a call cost, in billionths of a dollar, from its token usage. */
export function callCostNanoUsd(usage: TokenUsage): number {
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const prompt = usage.input_tokens + cacheWrite + cacheRead;
  const long = prompt > MODEL_PRICES.longPromptTokens;
  const input = long ? MODEL_PRICES.longInputNano : MODEL_PRICES.inputNano;
  const output = long ? MODEL_PRICES.longOutputNano : MODEL_PRICES.outputNano;
  return Math.ceil(
    usage.input_tokens * input + cacheWrite * input * 2 + cacheRead * input * 0.1 + usage.output_tokens * output,
  );
}

/** The month a call counts in, `YYYY-MM` in Paris. */
export const aiMonth = (now: Date) => parisDay(now).slice(0, 7);

/** The monthly cap in euro cents: the admin's setting, or 10 € without one (or with an unreadable one). */
export async function readAiMonthlyCapCents(db: Database): Promise<number> {
  const [row] = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, AI_MONTHLY_CAP_SETTING));
  const parsed = aiMonthlyCapCentsSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : DEFAULT_AI_MONTHLY_CAP_CENTS;
}

/** A call's place in the month's budget: `settle` replaces the reserved cost with the real one (0: not billed). */
export type AiReservation = { settle(costNanoUsd: number): Promise<void> };
export type AiBudget = {
  /** Reserves `maxCostNanoUsd` in the month's budget; null when that would pass the cap (nothing reserved). */
  reserve(maxCostNanoUsd: number): Promise<AiReservation | null>;
};

/**
 * The month's budget in `ai_usage_months`. A reservation is one statement that adds the call's highest possible cost
 * only if the total stays within the cap, so two calls at once never pass it together.
 */
export function databaseBudget(db: Database, clock: () => Date = () => new Date()): AiBudget {
  return {
    async reserve(maxCostNanoUsd) {
      const reserved = Math.ceil(maxCostNanoUsd);
      const month = aiMonth(clock());
      const capNano = (await readAiMonthlyCapCents(db)) * NANO_USD_PER_EURO_CENT;
      const t = schema.aiUsageMonths;
      const rows = await db.execute<{ month: string }>(sql`
        insert into ${t} (month, cost_nano_usd, calls)
        select ${month}, ${reserved}::bigint, 1
        where ${reserved}::bigint <= ${capNano}::bigint
        on conflict (month) do update
          set cost_nano_usd = ${t.costNanoUsd} + excluded.cost_nano_usd,
              calls = ${t.calls} + 1,
              updated_at = now()
          where ${t.costNanoUsd} + excluded.cost_nano_usd <= ${capNano}::bigint
        returning month`);
      if (rows.rows.length === 0) return null;
      let settled = false;
      return {
        async settle(costNanoUsd) {
          if (settled) return;
          settled = true;
          const delta = Math.ceil(costNanoUsd) - reserved;
          // A call given back (nothing billed) is not counted either.
          const given = costNanoUsd === 0 ? 1 : 0;
          await db
            .update(t)
            .set({
              costNanoUsd: sql`greatest(0, ${t.costNanoUsd} + ${delta}::bigint)`,
              calls: sql`greatest(0, ${t.calls} - ${given})`,
              updatedAt: sql`now()`,
            })
            .where(eq(t.month, month));
        },
      };
    },
  };
}
