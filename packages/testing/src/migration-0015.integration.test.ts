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

describe("migration 0015 (friends' opinions)", () => {
  it("hides her opinions on lists shared before it, keeps the default on the others", async () => {
    const database = await startTestDatabase();
    const before = await migrationsBefore("0015_");
    try {
      await runMigrations(database.url, before);
      const client = new pg.Client({ connectionString: database.url });
      await client.connect();
      try {
        await client.query(
          `insert into "user" (id, name, email, email_verified) values ('u1', 'U', 'u@t.local', true)`,
        );
        const lists = await client.query<{ id: string }>(
          `insert into wishlists (user_id, name, share_token_hash) values ('u1', 'Partagée', 'hash-0015'), ('u1', 'Privée', null)
           returning id`,
        );
        const [shared, private_] = lists.rows.map((r) => r.id);

        await runMigrations(database.url, MIGRATIONS_DIR);

        const rows = await client.query<{ id: string; show_owner_opinions: boolean }>(
          "select id, show_owner_opinions from wishlists",
        );
        expect(Object.fromEntries(rows.rows.map((r) => [r.id, r.show_owner_opinions]))).toEqual({
          [shared ?? ""]: false,
          [private_ ?? ""]: true,
        });
        const fresh = await client.query<{ show_owner_opinions: boolean }>(
          "insert into wishlists (user_id, name) values ('u1', 'Nouvelle') returning show_owner_opinions",
        );
        expect(fresh.rows[0]?.show_owner_opinions).toBe(true);

        const checks = await client.query<{ def: string }>(
          `select pg_get_constraintdef(oid) as def from pg_constraint
           where conname in ('wishlist_opinions_author_name_check', 'wishlist_opinions_note_check') order by conname`,
        );
        expect(checks.rows.map((r) => r.def)).toEqual([
          expect.stringContaining("320"),
          expect.stringContaining("1600"),
        ]);
      } finally {
        await client.end();
      }
    } finally {
      await rm(before, { recursive: true, force: true });
      await database.stop();
    }
  }, 60_000);
});
