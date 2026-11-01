import { createDb, sql } from "@closyria/db";
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "./vitest";

// packages/db has no test runner of its own; its database behaviour is checked here.
describe("createDb", () => {
  it("runs every connection in UTC, whatever the server's TimeZone", async () => {
    const database = await createTestDatabase();
    const { db, pool } = createDb(database.url, { max: 3 });
    try {
      // Mimic a server not in UTC (the VPS's PostgreSQL defaults to the system zone).
      const [{ name }] = (await db.execute<{ name: string }>(sql`select current_database() as name`)).rows as [
        { name: string },
      ];
      await db.execute(sql.raw(`alter database "${name}" set timezone = 'Europe/Paris'`));
      await pool.query("discard all"); // nothing cached from before the change
      const zones = await Promise.all(
        Array.from({ length: 3 }, () =>
          pool.query<{ TimeZone: string }>("show timezone").then((r) => r.rows[0]?.TimeZone),
        ),
      );
      expect(zones).toEqual(["UTC", "UTC", "UTC"]);
    } finally {
      await pool.end();
      await database.stop();
    }
  }, 60_000);
});
