import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@closyria/db";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { startTestDatabase } from "./postgres";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");

describe("migration 0016 (offrir)", () => {
  it("keeps one reserver per item, allows contributors, cascades with the item", async () => {
    const database = await startTestDatabase();
    try {
      await runMigrations(database.url, MIGRATIONS_DIR);
      const client = new pg.Client({ connectionString: database.url });
      await client.connect();
      try {
        await client.query(
          `insert into "user" (id, name, email, email_verified) values ('u1', 'U', 'u@t.local', true)`,
        );
        const list = await client.query<{ id: string; allow_gifts: boolean }>(
          `insert into wishlists (user_id, name) values ('u1', 'L') returning id, allow_gifts`,
        );
        expect(list.rows[0]?.allow_gifts).toBe(false);
        const wishlistId = list.rows[0]?.id;
        const profile = await client.query<{ id: string }>(
          `insert into profiles (user_id, name, audience, color) values ('u1', 'P', 'women', 'rose') returning id`,
        );
        const item = await client.query<{ id: string }>(
          `insert into items (user_id, profile_id) values ('u1', $1) returning id`,
          [profile.rows[0]?.id],
        );
        const itemId = item.rows[0]?.id;
        const give = (name: string, role: string) =>
          client.query(
            `insert into wishlist_gifts (wishlist_id, item_id, giver_name, giver_name_key, role) values ($1, $2, $3, $3, $4)`,
            [wishlistId, itemId, name, role],
          );
        await give("lea", "reserver");
        await expect(give("zoe", "reserver")).rejects.toThrow(/unique|duplicate/i);
        await give("zoe", "contributor");
        await expect(give("ana", "other")).rejects.toThrow(/check/i);
        await expect(give("zoe", "contributor")).rejects.toThrow(/unique|duplicate/i);

        await client.query("delete from items where id = $1", [itemId]);
        const left = await client.query("select 1 from wishlist_gifts");
        expect(left.rowCount).toBe(0);
      } finally {
        await client.end();
      }
    } finally {
      await database.stop();
    }
  }, 60_000);
});
