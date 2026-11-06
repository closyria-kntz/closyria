import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>["db"];

/**
 * Creates the connection pool and the Drizzle client.
 * On the server, DATABASE_URL uses the Unix socket with peer auth,
 * e.g. postgresql:///closyria?host=/var/run/postgresql
 *
 * Every connection runs in UTC (`-c TimeZone=UTC`): several columns are `timestamp without time zone`
 * filled by `DEFAULT now()`, which would otherwise be stored in the server's local time.
 */
export function createDb(connectionString: string, options: { max?: number } = {}) {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10, options: "-c TimeZone=UTC" });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export async function pingDb(db: Database): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/** Query operators, re-exported so consumers need no direct drizzle-orm dependency. */
export {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
export type { AuditDetails } from "./schema/audit";
export { type TrackedEvent, trackServer } from "./track";
export { schema };

/** Applies pending SQL migrations from `migrationsFolder` in a single connection. */
export async function runMigrations(connectionString: string, migrationsFolder: string) {
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const { db, pool } = createDb(connectionString, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}
