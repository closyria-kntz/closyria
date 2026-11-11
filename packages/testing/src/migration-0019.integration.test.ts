import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@closyria/db";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { startTestDatabase } from "./postgres";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");

describe("migration 0019 (boutique de la semaine)", () => {
  it("adds a nullable featured_at timestamp to shops, empty for existing shops", async () => {
    const database = await startTestDatabase();
    try {
      await runMigrations(database.url, MIGRATIONS_DIR);
      const client = new pg.Client({ connectionString: database.url });
      await client.connect();
      try {
        const column = await client.query<{ data_type: string; is_nullable: string }>(
          `select data_type, is_nullable from information_schema.columns
           where table_name = 'shops' and column_name = 'featured_at'`,
        );
        expect(column.rows).toEqual([{ data_type: "timestamp with time zone", is_nullable: "YES" }]);
        const shop = await client.query<{ featured_at: Date | null }>(
          `insert into shops (name, slug) values ('Les Cœurs', 'les-coeurs') returning featured_at`,
        );
        expect(shop.rows[0]?.featured_at).toBeNull();
        const featured = await client.query<{ featured_at: Date | null }>(
          `update shops set featured_at = now() where slug = 'les-coeurs' returning featured_at`,
        );
        expect(featured.rows[0]?.featured_at).toBeInstanceOf(Date);
      } finally {
        await client.end();
      }
    } finally {
      await database.stop();
    }
  }, 60_000);
});
