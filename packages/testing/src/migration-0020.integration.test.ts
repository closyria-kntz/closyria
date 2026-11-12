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

describe("migration 0020 (préférences : astuces fermées, découverte)", () => {
  it("counts accounts that already keep articles as onboarded, not the others; no tip closed", async () => {
    const database = await startTestDatabase();
    const before = await migrationsBefore("0020_");
    try {
      await runMigrations(database.url, before);
      const client = new pg.Client({ connectionString: database.url });
      await client.connect();
      try {
        await client.query(
          `insert into "user" (id, name, email, email_verified) values
             ('with-items', 'A', 'a@t.local', true), ('empty', 'B', 'b@t.local', true)`,
        );
        const profile = await client.query<{ id: string }>(
          `insert into profiles (user_id, name, audience, color) values ('with-items', 'P', 'women', 'rose') returning id`,
        );
        await client.query(`insert into items (user_id, profile_id) values ('with-items', $1)`, [profile.rows[0]?.id]);

        await runMigrations(database.url, MIGRATIONS_DIR);

        const rows = await client.query<{ id: string; seen_tips: string[]; onboarded_at: Date | null }>(
          `select id, seen_tips, onboarded_at from "user" order by id`,
        );
        expect(rows.rows.map((r) => [r.id, r.seen_tips, r.onboarded_at instanceof Date])).toEqual([
          ["empty", [], false],
          ["with-items", [], true],
        ]);
        const fresh = await client.query<{ seen_tips: string[]; onboarded_at: Date | null }>(
          `insert into "user" (id, name, email, email_verified) values ('new', 'C', 'c@t.local', true)
           returning seen_tips, onboarded_at`,
        );
        expect(fresh.rows[0]).toEqual({ seen_tips: [], onboarded_at: null });
      } finally {
        await client.end();
      }
    } finally {
      await rm(before, { recursive: true, force: true });
      await database.stop();
    }
  }, 60_000);
});
