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

describe("migration 0032 (alertes)", () => {
  it("watches every existing item, without a target price, and adds the alert tables with their rules", async () => {
    const database = await startTestDatabase();
    const before = await migrationsBefore("0032_");
    try {
      await runMigrations(database.url, before);
      const client = new pg.Client({ connectionString: database.url });
      await client.connect();
      try {
        await client.query(`insert into "user" (id, name, email, email_verified) values ('u', 'A', 'a@t.local', true)`);
        const profile = await client.query<{ id: string }>(
          `insert into profiles (user_id, name, audience, color) values ('u', 'Moi', 'women', 'rose') returning id`,
        );
        const profileId = profile.rows[0]?.id;
        const shop = await client.query<{ id: string }>(
          `insert into shops (name, slug) values ('S', 's') returning id`,
        );
        const shopId = shop.rows[0]?.id;
        const products = await client.query<{ id: string }>(
          `insert into products (shop_id, canonical_url, name) values ($1, 'https://s.test/a', 'A'), ($1, 'https://s.test/b', 'B')
           returning id`,
          [shopId],
        );
        const [productA, productB] = products.rows.map((r) => r.id);
        await client.query(
          `insert into items (user_id, profile_id, product_id, stage) values ('u', $1, $2, 'spotted'), ('u', $1, $3, 'owned')`,
          [profileId, productA, productB],
        );

        await runMigrations(database.url, MIGRATIONS_DIR);

        const items = await client.query<{ stage: string; alerts_enabled: boolean; target_price_cents: number | null }>(
          `select stage, alerts_enabled, target_price_cents from items order by stage desc`,
        );
        expect(items.rows).toEqual([
          { stage: "spotted", alerts_enabled: true, target_price_cents: null },
          { stage: "owned", alerts_enabled: true, target_price_cents: null },
        ]);
        await expect(client.query(`update items set target_price_cents = 0`)).rejects.toThrow(
          /items_target_price_check/,
        );

        const settings = await client.query(
          `insert into alert_settings (user_id) values ('u') returning size_back, target_price, digest, digest_hour`,
        );
        expect(settings.rows[0]).toEqual({ size_back: true, target_price: true, digest: true, digest_hour: 18 });
        await expect(client.query(`update alert_settings set digest_hour = 23`)).rejects.toThrow(
          /alert_settings_digest_hour_check/,
        );
        await expect(client.query(`update alert_settings set digest_hour = 6`)).rejects.toThrow(
          /alert_settings_digest_hour_check/,
        );

        await client.query(
          `insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ('u', 'https://push.test/1', 'k', 'a')`,
        );
        await expect(
          client.query(
            `insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ('u', 'https://push.test/1', 'k', 'a')`,
          ),
        ).rejects.toThrow(/push_subscriptions_endpoint_unique/);

        await expect(
          client.query(
            `insert into sale_periods (name, starts_on, ends_on) values ('À l''envers', '2027-01-13', '2027-01-12')`,
          ),
        ).rejects.toThrow(/sale_periods_dates_check/);
        const sale = await client.query<{ id: string }>(
          `insert into sale_periods (name, starts_on, ends_on) values ('Soldes d''hiver', '2027-01-13', '2027-02-09') returning id`,
        );

        const item = await client.query<{ id: string }>(`select id from items where stage = 'spotted'`);
        const itemId = item.rows[0]?.id;
        const event = await client.query<{ status: string }>(
          `insert into alert_events (user_id, profile_id, item_id, product_id, kind, size_label)
           values ('u', $1, $2, $3, 'size_back', 'M') returning status`,
          [profileId, itemId, productA],
        );
        expect(event.rows[0]?.status).toBe("pending");
        await client.query(`insert into alert_events (user_id, kind, sale_period_id) values ('u', 'sale_period', $1)`, [
          sale.rows[0]?.id,
        ]);
        await expect(
          client.query(`insert into alert_events (user_id, kind) values ('u', 'price_drop')`),
        ).rejects.toThrow(/alert_events_item_check/);
        await expect(client.query(`insert into alert_events (user_id, kind) values ('u', 'other')`)).rejects.toThrow(
          /alert_events_kind_check/,
        );
        await expect(client.query(`update alert_events set status = 'lost'`)).rejects.toThrow(
          /alert_events_status_check/,
        );

        await client.query(`insert into alert_sends (user_id, ok) values ('u', true)`);

        // An item deleted for good takes its alerts with it; the account takes everything.
        await client.query(`delete from items where id = $1`, [itemId]);
        const left = await client.query<{ kind: string }>(`select kind from alert_events`);
        expect(left.rows.map((r) => r.kind)).toEqual(["sale_period"]);
        await client.query(`delete from items`);
        await client.query(`delete from profiles`);
        await client.query(`delete from "user" where id = 'u'`);
        for (const table of ["alert_events", "alert_settings", "push_subscriptions", "alert_sends"]) {
          const count = await client.query<{ n: number }>(`select count(*)::int as n from ${table}`);
          expect(count.rows[0]?.n, table).toBe(0);
        }
      } finally {
        await client.end();
      }
    } finally {
      await rm(before, { recursive: true, force: true });
      await database.stop();
    }
  }, 60_000);
});
