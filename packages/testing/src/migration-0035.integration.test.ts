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

describe("migration 0035 (catalogue conforme)", () => {
  it("backfills pasted_at from the earliest qualifying paste or item, and writes no other product", async () => {
    const database = await startTestDatabase();
    const before = await migrationsBefore("0035_");
    try {
      await runMigrations(database.url, before);
      const client = new pg.Client({ connectionString: database.url });
      await client.connect();
      try {
        await client.query(`insert into "user" (id, name, email, email_verified, role) values
          ('u', 'U', 'u@t.local', true, 'user'), ('a', 'A', 'a@t.local', true, 'admin')`);
        const profiles = await client.query<{ id: string; user_id: string }>(
          `insert into profiles (user_id, name, audience, color) values ('u', 'Moi', 'women', 'rose'),
            ('a', 'Moi', 'women', 'rose') returning id, user_id`,
        );
        const profileOf = (user: string) => profiles.rows.find((p) => p.user_id === user)?.id;
        const shop = await client.query<{ id: string }>(
          `insert into shops (name, slug) values ('S', 's') returning id`,
        );
        const shopId = shop.rows[0]?.id;
        const product = async (name: string) =>
          (
            await client.query<{ id: string }>(
              `insert into products (shop_id, canonical_url, name) values ($1, $2, $2) returning id`,
              [shopId, `https://s.test/${name}`],
            )
          ).rows[0]?.id ?? "";
        const capture = (productId: string, by: string | null, status: string, at: string, trigger = "user") =>
          client.query(
            `insert into captures (product_id, shop_id, url, trigger, requested_by, status, created_at)
             values ($1, $2, 'https://s.test/x', $3, $4, $5, $6)`,
            [productId, shopId, trigger, by, status, at],
          );
        const item = (productId: string, user: string, at: string) =>
          client.query(`insert into items (user_id, profile_id, product_id, created_at) values ($1, $2, $3, $4)`, [
            user,
            profileOf(user),
            productId,
            at,
          ]);

        const pastedByHer = await product("her");
        await capture(pastedByHer, "u", "succeeded", "2026-11-02T00:00:00Z");
        const manualShop = await product("manual");
        await capture(manualShop, "u", "skipped_manual", "2026-11-03T00:00:00Z");
        const byFriend = await product("friend");
        await capture(byFriend, null, "succeeded", "2026-11-04T00:00:00Z");
        const keptByHer = await product("kept");
        await item(keptByHer, "u", "2026-11-05T00:00:00Z");
        // Both: the earliest one counts.
        const both = await product("both");
        await capture(both, "u", "succeeded", "2026-11-07T00:00:00Z");
        await item(both, "u", "2026-11-06T00:00:00Z");
        // Never published: an admin's paste or item, a queued or failed capture, an import alone.
        const byAdmin = await product("admin");
        await capture(byAdmin, "a", "succeeded", "2026-11-08T00:00:00Z");
        const keptByAdmin = await product("admin-item");
        await item(keptByAdmin, "a", "2026-11-08T00:00:00Z");
        const queued = await product("queued");
        await capture(queued, "u", "queued", "2026-11-09T00:00:00Z");
        await capture(queued, "u", "failed", "2026-11-09T00:00:00Z");
        const imported = await product("imported");
        const rowVersions = async () =>
          new Map(
            (await client.query<{ id: string; xmin: string }>("select id, xmin::text from products")).rows.map((r) => [
              r.id,
              r.xmin,
            ]),
          );
        const versionsBefore = await rowVersions();

        await runMigrations(database.url, MIGRATIONS_DIR);

        const { rows } = await client.query<{ id: string; pasted_at: Date | null }>(
          "select id, pasted_at from products",
        );
        const pasted = new Map(rows.map((r) => [r.id, r.pasted_at?.toISOString() ?? null]));
        expect(pasted.get(pastedByHer)).toBe("2026-11-02T00:00:00.000Z");
        expect(pasted.get(manualShop)).toBe("2026-11-03T00:00:00.000Z");
        expect(pasted.get(byFriend)).toBe("2026-11-04T00:00:00.000Z");
        expect(pasted.get(keptByHer)).toBe("2026-11-05T00:00:00.000Z");
        expect(pasted.get(both)).toBe("2026-11-06T00:00:00.000Z");
        for (const id of [byAdmin, keptByAdmin, queued, imported]) expect(pasted.get(id)).toBeNull();
        // Only the qualifying products were written (the others keep their row version).
        const versionsAfter = await rowVersions();
        for (const id of [byAdmin, keptByAdmin, queued, imported]) {
          expect(versionsAfter.get(id)).toBe(versionsBefore.get(id));
        }
        expect(versionsAfter.get(pastedByHer)).not.toBe(versionsBefore.get(pastedByHer));
      } finally {
        await client.end();
      }
    } finally {
      await rm(before, { recursive: true, force: true });
      await database.stop();
    }
  }, 120_000);
});
