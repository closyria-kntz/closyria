import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, sql } from "@closyria/db";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { databaseUrl, migrateTestDatabase, startEphemeralCluster, startTestDatabase } from "./postgres";
import { createTestDatabase } from "./vitest";

const tempDirs = () => new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("closyria-pg-")));

async function canConnect(url: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  client.on("error", () => {});
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

describe("startTestDatabase", () => {
  it("serves a reachable database, then becomes unreachable after stop(), which is idempotent", async () => {
    const database = await startTestDatabase();
    const client = new pg.Client({ connectionString: database.url });
    await client.connect();
    const result = await client.query<{ one: number }>("select 1 as one");
    await client.end();
    expect(result.rows[0]?.one).toBe(1);

    await database.stop();
    await expect(database.stop()).resolves.toBeUndefined();
    expect(await canConnect(database.url)).toBe(false);
  }, 60_000);

  it("applies the migrations", async () => {
    const database = await startTestDatabase();
    try {
      await migrateTestDatabase(database.url);
      const client = new pg.Client({ connectionString: database.url });
      await client.connect();
      const tables = await client.query("select 1 from pg_tables where schemaname = 'public' and tablename = 'user'");
      await client.end();
      expect(tables.rowCount).toBe(1);
    } finally {
      await database.stop();
    }
  }, 60_000);
});

describe.skipIf(Boolean(process.env.TEST_DATABASE_URL))("ephemeral cluster", () => {
  it("stops a half-started postmaster, removes its directory and reports the server log on failure", async () => {
    const before = tempDirs();
    const failure = startEphemeralCluster({ config: ["shared_buffers = 'not a size'"] });
    await expect(failure).rejects.toThrow(/server\.log[\s\S]*shared_buffers/);
    expect([...tempDirs()].filter((name) => !before.has(name))).toEqual([]);
  }, 60_000);

  it("stopSync() stops the cluster and removes its directory", async () => {
    const cluster = await startEphemeralCluster();
    const root = decodeURIComponent(
      new URL(`http://x${cluster.url.slice(cluster.url.indexOf("?"))}`).searchParams.get("host") ?? "",
    );
    expect(existsSync(join(root, "data"))).toBe(true);
    cluster.stopSync();
    expect(existsSync(root)).toBe(false);
    expect(await canConnect(cluster.url)).toBe(false);
    await expect(cluster.stop()).resolves.toBeUndefined();
  }, 60_000);
});

describe("databaseUrl", () => {
  it("swaps the database of TCP and Unix-socket URLs", () => {
    expect(databaseUrl("postgresql://u:p@localhost:5432/postgres", "x")).toBe("postgresql://u:p@localhost:5432/x");
    expect(databaseUrl("postgresql://postgres@/postgres?host=%2Ftmp%2Fa&port=1", "x")).toBe(
      "postgresql://postgres@/x?host=%2Ftmp%2Fa&port=1",
    );
  });
});

describe("createTestDatabase (globalSetup template)", () => {
  it("gives each caller its own migrated database, dropped by stop()", async () => {
    const [a, b] = await Promise.all([createTestDatabase(), createTestDatabase()]);
    try {
      expect(a.url).not.toBe(b.url);
      for (const database of [a, b]) {
        const { db, pool } = createDb(database.url, { max: 1 });
        const plans = await db.execute<{ id: string }>(sql`select id from plans`);
        await pool.end();
        expect(plans.rows.map((r) => r.id)).toContain("free");
      }
    } finally {
      await Promise.all([a.stop(), b.stop()]);
    }
    expect(await canConnect(a.url)).toBe(false);
  }, 60_000);
});
