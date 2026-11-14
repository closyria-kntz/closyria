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

describe("migration 0031 (dates de mise en ligne)", () => {
  it("marks a stored date as given by the shop, and leaves the undated ones unknown without inventing a date", async () => {
    const database = await startTestDatabase();
    const before = await migrationsBefore("0031_");
    try {
      await runMigrations(database.url, before);
      const client = new pg.Client({ connectionString: database.url });
      await client.connect();
      try {
        const shops = await client.query<{ id: string; slug: string }>(
          `insert into shops (name, slug, platform) values ('Shopify', 'shopify-shop', 'shopify'),
             ('Woo', 'woo-shop', 'woocommerce') returning id, slug`,
        );
        const shopify = shops.rows.find((s) => s.slug === "shopify-shop")?.id;
        const woo = shops.rows.find((s) => s.slug === "woo-shop")?.id;
        await client.query(
          `insert into products (shop_id, canonical_url, name, published_at, created_at) values
             ($1, 'https://s.test/a', 'Shopify', '2026-10-01T10:00:00Z', '2026-11-13T00:00:00Z'),
             ($2, 'https://w.test/b', 'Woo importé', null, '2026-11-14T00:00:00Z'),
             ($2, 'https://w.test/c', 'Woo collé avec sa date', '2026-09-01T00:00:00Z', '2026-11-01T00:00:00Z')`,
          [shopify, woo],
        );

        await runMigrations(database.url, MIGRATIONS_DIR);

        const rows = await client.query<{ name: string; published_source: string; published_at: Date | null }>(
          `select name, published_source, published_at from products order by canonical_url`,
        );
        expect(rows.rows.map((r) => [r.name, r.published_source, r.published_at?.toISOString() ?? null])).toEqual([
          ["Shopify", "shop", "2026-10-01T10:00:00.000Z"],
          ["Woo importé", "unknown", null],
          ["Woo collé avec sa date", "shop", "2026-09-01T00:00:00.000Z"],
        ]);
        const fresh = await client.query<{ published_source: string; shop_rank: number | null }>(
          `insert into products (shop_id, canonical_url) values ($1, 'https://w.test/d')
           returning published_source, shop_rank`,
          [woo],
        );
        expect(fresh.rows[0]).toEqual({ published_source: "unknown", shop_rank: null });
        await expect(client.query(`update products set published_source = 'guess'`)).rejects.toThrow(
          /products_published_source_check/,
        );
      } finally {
        await client.end();
      }
    } finally {
      await rm(before, { recursive: true, force: true });
      await database.stop();
    }
  }, 60_000);
});
