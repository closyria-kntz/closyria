import type { Database } from "@closyria/db";
import { sql } from "drizzle-orm";
import { DEFAULT_PLAN_ID, type EntitlementKey, type MonthlyKey, monthlyKeySchema } from "./keys";

export type Limit = number | "unlimited";
export type Remaining = { allowed: boolean; remaining: Limit };

export type EntitlementsDeps = {
  db: Pick<Database, "execute">;
  /** Injected clock, so tests change month without sleeping. */
  now?: () => Date;
};

/** `YYYY-MM`, in UTC. */
export function periodOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

const positiveInt = (amount: number) => {
  if (!Number.isSafeInteger(amount) || amount < 1) throw new RangeError("amount must be a positive integer");
};

export function createEntitlements({ db, now = () => new Date() }: EntitlementsDeps) {
  /**
   * The limit of the user's current plan. A user without a plan, or whose plan ended, is on « Gratuit ».
   * A key the plan does not list, or lists as disabled, is 0; a null limit is unlimited.
   */
  async function getLimit(userId: string, key: EntitlementKey, at: Date = now()): Promise<Limit> {
    const result = await db.execute<{ limit_value: number | null; enabled: boolean }>(sql`
      select e.limit_value, e.enabled
      from plan_entitlements e
      where e.key = ${key}
        and e.plan_id = coalesce(
          (select up.plan_id from user_plans up
           where up.user_id = ${userId}
             and up.starts_at <= ${at}
             and (up.ends_at is null or up.ends_at > ${at})),
          ${DEFAULT_PLAN_ID})`);
    const row = result.rows[0];
    if (!row?.enabled) return 0;
    return row.limit_value ?? "unlimited";
  }

  /**
   * Consumes `amount` of a monthly key, atomically: a single statement inserts the month's counter or
   * increments it only if the result stays within the limit, so concurrent calls never exceed it.
   * When refused, nothing is consumed and `remaining` is what is left this month.
   */
  async function checkAndConsume(userId: string, key: MonthlyKey, amount = 1): Promise<Remaining> {
    positiveInt(amount);
    monthlyKeySchema.parse(key);
    const at = now();
    const limit = await getLimit(userId, key, at);
    const period = periodOf(at);
    // `limit` is null for unlimited: the comparisons below then always pass.
    const max = limit === "unlimited" ? null : limit;
    const result = await db.execute<{ value: number }>(sql`
      insert into usage_counters (user_id, key, period, value)
      select ${userId}, ${key}, ${period}, ${amount}::int
      where ${max}::int is null or ${amount}::int <= ${max}::int
      on conflict (user_id, key, period) do update
        set value = usage_counters.value + ${amount}::int
        where ${max}::int is null or usage_counters.value + ${amount}::int <= ${max}::int
      returning value`);
    const row = result.rows[0];
    if (row) return { allowed: true, remaining: max === null ? "unlimited" : max - row.value };
    // Refused: report what is left (informational read; the decision above was atomic).
    const used = await db.execute<{ value: number }>(
      sql`select value from usage_counters where user_id = ${userId} and key = ${key} and period = ${period}`,
    );
    return { allowed: false, remaining: Math.max(0, (max ?? 0) - (used.rows[0]?.value ?? 0)) };
  }

  /**
   * For stock keys (`wardrobe_items`, `active_alerts`): is there room for one more, given the live count?
   * Nothing is stored: the count is the caller's table, so deleting an item frees room by itself.
   */
  async function checkLimit(userId: string, key: EntitlementKey, currentCount: number): Promise<Remaining> {
    const limit = await getLimit(userId, key);
    if (limit === "unlimited") return { allowed: true, remaining: "unlimited" };
    const remaining = Math.max(0, limit - currentCount);
    return { allowed: remaining > 0, remaining };
  }

  return { getLimit, checkAndConsume, checkLimit };
}

export type Entitlements = ReturnType<typeof createEntitlements>;
