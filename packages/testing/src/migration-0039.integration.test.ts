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

describe("migration 0039 (lecture des e-mails)", () => {
  it("keeps the existing alerts, ties « Commande reçue » to its order, and adds the AI's budget", async () => {
    const database = await startTestDatabase();
    const before = await migrationsBefore("0039_");
    try {
      await runMigrations(database.url, before);
      const client = new pg.Client({ connectionString: database.url });
      await client.connect();
      try {
        await client.query(
          `insert into "user" (id, name, email, email_verified, role) values ('u', 'U', 'u@t.local', true, 'user')`,
        );
        await client.query(`insert into alert_events (user_id, kind, send_after) values ('u', 'sale_period', now())`);
        await runMigrations(database.url, MIGRATIONS_DIR);

        const kinds = await client.query<{ kind: string }>("select kind from alert_events");
        expect(kinds.rows).toEqual([{ kind: "sale_period" }]);
        const profile = await client.query<{ id: string }>(
          `insert into profiles (user_id, name, audience, color) values ('u', 'Moi', 'women', 'rose') returning id`,
        );
        const order = await client.query<{ id: string }>(
          `insert into orders (user_id, profile_id, source, parse_method) values ('u', $1, 'email', 'known') returning id`,
          [profile.rows[0]?.id],
        );
        await expect(
          client.query(`insert into alert_events (user_id, kind) values ('u', 'order_received')`),
        ).rejects.toThrow(/alert_events_order_check/);
        await client.query(`insert into alert_events (user_id, kind, order_id) values ('u', 'order_received', $1)`, [
          order.rows[0]?.id,
        ]);
        await client.query("delete from orders");
        const left = await client.query("select kind from alert_events");
        expect(left.rows).toEqual([{ kind: "sale_period" }]);

        await client.query(`insert into app_settings (key, value) values ('ai_monthly_cap_cents', '1000')`);
        await client.query(`insert into ai_usage_months (month, cost_nano_usd, calls) values ('2026-11', 270000, 1)`);
        await expect(client.query(`insert into ai_usage_months (month) values ('2026-13')`)).rejects.toThrow(
          /ai_usage_months_month_check/,
        );
      } finally {
        await client.end();
      }
    } finally {
      await rm(before, { recursive: true, force: true });
      await database.stop();
    }
  }, 120_000);
});
