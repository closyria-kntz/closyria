import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>["db"];

/**
 * Creates the connection pool and the Drizzle client.
 * On the server, DATABASE_URL uses the Unix socket with peer auth,
 * e.g. postgresql:///closyria?host=/var/run/postgresql
 */
export function createDb(connectionString: string, options: { max?: number } = {}) {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
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
