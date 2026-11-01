import type { Database } from "@closyria/db";
import { getTableName, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

/** A database handle or an open transaction. */
export type DbExecutor = Pick<Database, "execute">;

const ownedTables = new Map<PgTable, PgColumn>();

/**
 * Declares a table holding a user's data, through its user id column.
 * When an anonymous user signs in, her rows in every registered table move to the account.
 *
 * Requirements (checked against the database by auth.integration.test.ts):
 * - `userIdColumn` has a foreign key to `user(id)` with ON DELETE CASCADE, so deleting the
 *   anonymous user after the move, or deleting an account, leaves no orphan rows;
 * - tables with a per-user unique constraint must handle the merge into an existing account.
 */
export function registerOwnedTable(table: PgTable, userIdColumn: PgColumn): void {
  if (userIdColumn.table !== table) throw new Error("userIdColumn must belong to table");
  ownedTables.set(table, userIdColumn);
}

/** Moves every row of the registered tables from one user to another. */
export async function reassignUserData(fromUserId: string, toUserId: string, tx: DbExecutor): Promise<void> {
  if (fromUserId === toUserId) return;
  for (const [table, column] of ownedTables) {
    await tx.execute(
      sql`update ${table} set ${sql.identifier(column.name)} = ${toUserId} where ${column} = ${fromUserId}`,
    );
  }
}

/** The registered `{ table, column }` names, for checks against the database. */
export function listOwnedColumns(): { table: string; column: string }[] {
  return [...ownedTables].map(([table, column]) => ({ table: getTableName(table), column: column.name }));
}
