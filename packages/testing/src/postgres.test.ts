import pg from "pg";
import { describe, expect, it } from "vitest";
import { migrateTestDatabase, startTestDatabase } from "./postgres";

describe("startTestDatabase", () => {
  it("serves a reachable database, then becomes unreachable after stop()", async () => {
    const database = await startTestDatabase();
    let stopped = false;
    try {
      const client = new pg.Client({ connectionString: database.url });
      await client.connect();
      const result = await client.query<{ one: number }>("select 1 as one");
      await client.end();
      expect(result.rows[0]?.one).toBe(1);
    } finally {
      await database.stop();
      stopped = true;
    }
    expect(stopped).toBe(true);

    const after = new pg.Client({ connectionString: database.url, connectionTimeoutMillis: 2000 });
    after.on("error", () => {});
    await expect(after.connect()).rejects.toThrow();
  }, 60_000);

  it("applies the migrations without error", async () => {
    const database = await startTestDatabase();
    try {
      await expect(migrateTestDatabase(database.url)).resolves.toBeUndefined();
    } finally {
      await database.stop();
    }
  }, 60_000);
});
