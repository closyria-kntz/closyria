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

describe("migration 0025 (retours catalogue : plusieurs tailles, avancement de l'import)", () => {
  it("turns each saved size into a one-size list, and an empty or missing one into an empty list", async () => {
    const database = await startTestDatabase();
    const before = await migrationsBefore("0025_");
    try {
      await runMigrations(database.url, before);
      const client = new pg.Client({ connectionString: database.url });
      await client.connect();
      try {
        await client.query(`insert into "user" (id, name, email, email_verified) values ('u', 'A', 'a@t.local', true)`);
        await client.query(
          `insert into profiles (user_id, name, audience, color, size_top, size_bottom, size_shoes, position) values
             ('u', 'Moi', 'women', 'rose', 'M', ' 38 ', null, 0),
             ('u', 'Léa', 'women', 'rose', null, '', '38,5', 1)`,
        );

        await runMigrations(database.url, MIGRATIONS_DIR);

        const rows = await client.query<{
          name: string;
          size_top: string[];
          size_bottom: string[];
          size_shoes: string[];
        }>(`select name, size_top, size_bottom, size_shoes from profiles order by position`);
        expect(rows.rows).toEqual([
          { name: "Moi", size_top: ["M"], size_bottom: ["38"], size_shoes: [] },
          { name: "Léa", size_top: [], size_bottom: [], size_shoes: ["38,5"] },
        ]);
        const fresh = await client.query<{ size_top: string[] }>(
          `insert into profiles (user_id, name, audience, color) values ('u', 'P', 'women', 'rose') returning size_top`,
        );
        expect(fresh.rows[0]?.size_top).toEqual([]);
        await expect(
          client.query(`update profiles set size_top = '{a,b,c,d,e,f,g,h,i}' where name = 'P'`),
        ).rejects.toThrow(/profiles_size_top_check/);
        await expect(client.query(`update profiles set size_shoes = null where name = 'P'`)).rejects.toThrow(
          /null value/,
        );

        const shop = await client.query(
          `insert into shops (name, slug) values ('S', 's')
           returning import_state, import_started_at, import_pages, import_seen, last_import_created, last_import_removed`,
        );
        expect(shop.rows[0]).toEqual({
          import_state: null,
          import_started_at: null,
          import_pages: 0,
          import_seen: 0,
          last_import_created: null,
          last_import_removed: null,
        });
        await expect(client.query(`update shops set import_state = 'done'`)).rejects.toThrow(
          /shops_import_state_check/,
        );
        await client.query(`update shops set import_state = 'running', import_started_at = now()`);

        const tokens = await client.query<{ t: string[]; one: boolean; none: boolean }>(
          `select catalog_size_tokens('M (38)') as t, catalog_is_one_size('T.U.') as one, catalog_is_one_size('M') as none`,
        );
        expect(tokens.rows[0]).toEqual({ t: ["38", "m", "m(38)"], one: true, none: false });
      } finally {
        await client.end();
      }
    } finally {
      await rm(before, { recursive: true, force: true });
      await database.stop();
    }
  }, 60_000);
});
