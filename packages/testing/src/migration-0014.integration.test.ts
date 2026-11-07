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

describe("migration 0014 (love levels)", () => {
  it("turns the favorites into level 2 and the others into no level", async () => {
    const database = await startTestDatabase();
    const before = await migrationsBefore("0014_");
    try {
      await runMigrations(database.url, before);
      const client = new pg.Client({ connectionString: database.url });
      await client.connect();
      try {
        await client.query(
          `insert into "user" (id, name, email, email_verified) values ('u1', 'U', 'u@t.local', true)`,
        );
        const profile = await client.query<{ id: string }>(
          `insert into profiles (user_id, name, audience, color) values ('u1', 'Moi', 'women', 'plum') returning id`,
        );
        const shop = await client.query<{ id: string }>(
          `insert into shops (name, slug) values ('Shop', 'shop-0014') returning id`,
        );
        const products = await client.query<{ id: string }>(
          `insert into products (shop_id, canonical_url) values ($1, 'https://s.test/1'), ($1, 'https://s.test/2')
           returning id`,
          [shop.rows[0]?.id],
        );
        const [loved, plain] = products.rows.map((r) => r.id);
        await client.query(
          `insert into items (user_id, profile_id, product_id, favorite) values ('u1', $1, $2, true), ('u1', $1, $3, false)`,
          [profile.rows[0]?.id, loved, plain],
        );

        await runMigrations(database.url, MIGRATIONS_DIR);

        const rows = await client.query<{ product_id: string; love_level: number | null; priority: boolean }>(
          "select product_id, love_level, priority, why, in_order_draft from items",
        );
        expect(Object.fromEntries(rows.rows.map((r) => [r.product_id, r]))).toEqual({
          [loved ?? ""]: { product_id: loved, love_level: 2, priority: false, why: null, in_order_draft: false },
          [plain ?? ""]: { product_id: plain, love_level: null, priority: false, why: null, in_order_draft: false },
        });
        const columns = await client.query(
          "select 1 from information_schema.columns where table_name = 'items' and column_name = 'favorite'",
        );
        expect(columns.rowCount).toBe(0);
      } finally {
        await client.end();
      }
    } finally {
      await rm(before, { recursive: true, force: true });
      await database.stop();
    }
  }, 60_000);
});
