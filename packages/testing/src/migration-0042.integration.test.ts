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

describe("migration 0042 (retours et Instagram)", () => {
  it("dates the validated orders from their last change, leaves drafts and dismissed ones, bounds the new columns", async () => {
    const database = await startTestDatabase();
    const before = await migrationsBefore("0042_");
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
        for (const [status, updated] of [
          ["confirmed", "2026-11-03T10:00:00Z"],
          ["draft", "2026-11-04T10:00:00Z"],
          ["dismissed", "2026-11-05T10:00:00Z"],
        ]) {
          await client.query(
            `insert into orders (user_id, profile_id, source, parse_method, status, updated_at)
             values ('u', $1, 'email', 'known', $2, $3)`,
            [profileId, status, updated],
          );
        }
        await runMigrations(database.url, MIGRATIONS_DIR);

        const rows = await client.query<{ status: string; confirmed: string | null; asked: string | null }>(
          `select status, to_char(confirmed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') as confirmed,
             received_asked_at as asked
           from orders order by status`,
        );
        expect(rows.rows).toEqual([
          { status: "confirmed", confirmed: "2026-11-03T10:00", asked: null },
          { status: "dismissed", confirmed: null, asked: null },
          { status: "draft", confirmed: null, asked: null },
        ]);

        // An item's source link: 1 to 2 048 characters.
        for (const url of ["", `https://www.instagram.com/${"x".repeat(2030)}`]) {
          await expect(
            client.query(
              `insert into items (user_id, profile_id, name_override, source_url) values ('u', $1, 'Robe', $2)`,
              [profileId, url],
            ),
          ).rejects.toThrow(/items_source_url_check/);
        }
        const item = await client.query<{ id: string }>(
          `insert into items (user_id, profile_id, name_override, stage, source_url)
           values ('u', $1, 'Robe', 'owned', 'https://www.instagram.com/p/x') returning id`,
          [profileId],
        );
        const itemId = item.rows[0]?.id;
        // One return reminder per item, ever; it names the item and its profile.
        await client.query(
          `insert into alert_events (user_id, profile_id, item_id, kind) values ('u', $1, $2, 'return_reminder')`,
          [profileId, itemId],
        );
        await expect(
          client.query(
            `insert into alert_events (user_id, profile_id, item_id, kind) values ('u', $1, $2, 'return_reminder')`,
            [profileId, itemId],
          ),
        ).rejects.toThrow(/alert_events_return_reminder_idx/);
        await expect(
          client.query(`insert into alert_events (user_id, kind) values ('u', 'return_reminder')`),
        ).rejects.toThrow(/alert_events_return_reminder_check/);
        await expect(
          client.query(`insert into alert_events (user_id, kind) values ('u', 'order_received_check')`),
        ).rejects.toThrow(/alert_events_order_check/);
      } finally {
        await client.end();
      }
    } finally {
      await rm(before, { recursive: true, force: true });
      await database.stop();
    }
  }, 120_000);
});
