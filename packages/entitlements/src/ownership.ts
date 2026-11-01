import { registerOwnedTable } from "@closyria/auth";
import { schema } from "@closyria/db";
import { sql } from "drizzle-orm";

/**
 * Anonymous → account linking. The generic move would violate the primary keys when both users have a row:
 * - counters of the same key and period are summed;
 * - the account keeps its own plan; the anonymous user's plan only moves when the account has none.
 * Rows left on the anonymous user are removed with it (ON DELETE CASCADE).
 *
 * Explicit call, made where `createAuth` is wired (apps/api): the registry lives in the process that runs
 * `onLinkAccount`, so a bare import elsewhere would leave it dormant. Idempotent.
 */
export function registerEntitlementsOwnedTables(): void {
  registerOwnedTable(schema.usageCounters, schema.usageCounters.userId, async (from, to, tx) => {
    await tx.execute(sql`
      insert into usage_counters (user_id, key, period, value)
      select ${to}, key, period, value from usage_counters where user_id = ${from}
      on conflict (user_id, key, period) do update set value = usage_counters.value + excluded.value`);
    await tx.execute(sql`delete from usage_counters where user_id = ${from}`);
  });

  registerOwnedTable(schema.userPlans, schema.userPlans.userId, async (from, to, tx) => {
    await tx.execute(sql`
      update user_plans set user_id = ${to}
      where user_id = ${from} and not exists (select 1 from user_plans where user_id = ${to})`);
  });
}
