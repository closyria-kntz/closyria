import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/** `column IN ('a', 'b')` built from a closed value set shared with the API, so the lists never drift. */
export const oneOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} IN (${sql.join(
    values.map((v) => sql.raw(`'${v}'`)),
    sql.raw(", "),
  )})`;
