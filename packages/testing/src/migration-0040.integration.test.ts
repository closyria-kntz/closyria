import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@closyria/db";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { startTestDatabase } from "./postgres";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");

type Journal = { entries: { idx: number; tag: string }[] };

/** A copy of the migrations folder that stops before `tag` (journal truncated). */
async function migrationsBefore(tag: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "closyria-migrations-"));
  await cp(MIGRATIONS_DIR, dir, { recursive: true });
  const journalPath = join(dir, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
  const stop = journal.entries.findIndex((e) => e.tag.startsWith(tag));
  if (stop < 0) throw new Error(`no migration ${tag}`);
  await writeFile(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, stop) }));
  return dir;
}

describe("migration 0040 (boutique saisie)", () => {
  it("keeps the existing orders without a typed shop name and bounds the new one", async () => {
    const database = await startTestDatabase();
    const before = await migrationsBefore("0040_");
    try {
      await runMigrations(database.url, before);
      const client = new pg.Client({ connectionString: database.url });
      await client.connect();
      try {
        await client.query(
          `insert into "user" (id, name, email, email_verified, role) values ('u', 'U', 'u@t.local', true, 'user')`,
        );
        const profile = await client.query<{ id: string }>(
          `insert into profiles (user_id, name, audience, color) values ('u', 'Moi', 'women', 'rose') returning id`,
        );
        const profileId = profile.rows[0]?.id;
        await client.query(
          `insert into orders (user_id, profile_id, source, parse_method) values ('u', $1, 'email', 'known')`,
          [profileId],
        );
        await runMigrations(database.url, MIGRATIONS_DIR);

        const kept = await client.query("select shop_id, shop_name from orders");
        expect(kept.rows).toEqual([{ shop_id: null, shop_name: null }]);
        await client.query(
          `insert into orders (user_id, profile_id, source, parse_method, shop_name)
           values ('u', $1, 'manual', 'manual', 'La Petite Échoppe')`,
          [profileId],
        );
        for (const name of ["", "x".repeat(121)]) {
          await expect(
            client.query(
              `insert into orders (user_id, profile_id, source, parse_method, shop_name)
               values ('u', $1, 'manual', 'manual', $2)`,
              [profileId, name],
            ),
          ).rejects.toThrow(/orders_shop_name_check/);
        }
      } finally {
        await client.end();
      }
    } finally {
      await rm(before, { recursive: true, force: true });
      await database.stop();
    }
  }, 120_000);
});
