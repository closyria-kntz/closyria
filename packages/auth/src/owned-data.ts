import type { Database } from "@closyria/db";
import { getTableName, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

/** A database handle or an open transaction. */
export type DbExecutor = Pick<Database, "execute">;

/** Moves one table's rows when the generic `update … set user_id` cannot (unique constraints to merge). */
export type OwnedTableReassign = (fromUserId: string, toUserId: string, tx: DbExecutor) => Promise<void>;

const ownedTables = new Map<PgTable, { column: PgColumn; reassign?: OwnedTableReassign }>();

/**
 * Declares a table holding a user's data, through its user id column.
 * When an anonymous user signs in, her rows in every registered table move to the account.
 *
 * Requirements (checked against the database by auth.integration.test.ts):
 * - `userIdColumn` has a foreign key to `user(id)` with ON DELETE CASCADE, so deleting the
 *   anonymous user after the move, or deleting an account, leaves no orphan rows;
 * - tables with a per-user unique constraint must handle the merge into an existing account, by passing
 *   `reassign`, which then replaces the generic move for that table.
 */
export function registerOwnedTable(table: PgTable, userIdColumn: PgColumn, reassign?: OwnedTableReassign): void {
  if (userIdColumn.table !== table) throw new Error("userIdColumn must belong to table");
  ownedTables.set(table, reassign ? { column: userIdColumn, reassign } : { column: userIdColumn });
}

/** Moves every row of the registered tables from one user to another. */
export async function reassignUserData(fromUserId: string, toUserId: string, tx: DbExecutor): Promise<void> {
  if (fromUserId === toUserId) return;
  for (const [table, { column, reassign }] of ownedTables) {
    if (reassign) {
      await reassign(fromUserId, toUserId, tx);
      continue;
    }
    await tx.execute(
      sql`update ${table} set ${sql.identifier(column.name)} = ${toUserId} where ${column} = ${fromUserId}`,
    );
  }
}

/** The registered `{ table, column }` names, for checks against the database. */
export function listOwnedColumns(): { table: string; column: string }[] {
  return [...ownedTables].map(([table, { column }]) => ({ table: getTableName(table), column: column.name }));
}
