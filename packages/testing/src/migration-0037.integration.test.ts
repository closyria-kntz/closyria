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

describe("migration 0037 (après la commande)", () => {
  it("gives existing shops a 14-day return delay and items no deadline, and the new tables cascade from the user", async () => {
    const database = await startTestDatabase();
    const before = await migrationsBefore("0037_");
    try {
      await runMigrations(database.url, before);
      const client = new pg.Client({ connectionString: database.url });
      await client.connect();
      try {
        await client.query(`insert into "user" (id, name, email, email_verified, role) values
          ('u', 'U', 'u@t.local', true, 'user'), ('v', 'V', 'v@t.local', true, 'user')`);
        const shop = await client.query<{ id: string }>(
          `insert into shops (name, slug) values ('S', 's') returning id`,
        );
        const shopId = shop.rows[0]?.id;
        const product = await client.query<{ id: string }>(
          `insert into products (shop_id, canonical_url, name) values ($1, 'https://s.test/p', 'Robe') returning id`,
          [shopId],
        );
        const profile = await client.query<{ id: string }>(
          `insert into profiles (user_id, name, audience, color) values ('u', 'Moi', 'women', 'rose') returning id`,
        );
        const profileId = profile.rows[0]?.id;
        await client.query(
          `insert into items (user_id, profile_id, product_id, stage) values ('u', $1, $2, 'ordered')`,
          [profileId, product.rows[0]?.id],
        );

        await runMigrations(database.url, MIGRATIONS_DIR);

        const shops = await client.query("select return_days, returns_url from shops");
        expect(shops.rows).toEqual([{ return_days: 14, returns_url: null }]);
        const items = await client.query("select stage, return_deadline from items");
        expect(items.rows).toEqual([{ stage: "ordered", return_deadline: null }]);
        await expect(client.query("update shops set return_days = -1")).rejects.toThrow(/shops_return_days_check/);

        // Her address, e-mails (one accepted, one ignored), an order with its line, parcel and step.
        const inbox = await client.query<{ id: string }>(
          `insert into order_inboxes (user_id, local_part) values ('u', 'marie-k7f2') returning id`,
        );
        const inboxId = inbox.rows[0]?.id;
        // One active address per account; another person's local part is unique too.
        await expect(
          client.query(`insert into order_inboxes (user_id, local_part) values ('u', 'marie-b9x1')`),
        ).rejects.toThrow(/order_inboxes_user_id_active_idx/);
        await client.query(`insert into order_inboxes (user_id, local_part, active) values ('u', 'marie-b9x1', false)`);
        await expect(
          client.query(`insert into order_inboxes (user_id, local_part) values ('v', 'marie-k7f2')`),
        ).rejects.toThrow(/order_inboxes_local_part_unique/);
        await expect(
          client.query(`insert into order_inboxes (user_id, local_part) values ('v', 'Marie@x')`),
        ).rejects.toThrow(/order_inboxes_local_part_check/);
        const email = await client.query<{ id: string }>(
          `insert into inbound_emails (user_id, inbox_id, from_address, auth_ok, status, purge_after)
           values ('u', $1, 'u@t.local', true, 'parsed', now() + interval '30 days') returning id`,
          [inboxId],
        );
        await client.query(
          `insert into inbound_emails (inbox_id, from_address, auth_ok, status, purge_after)
           values ($1, 'x@t.local', false, 'ignored', now() + interval '30 days')`,
          [inboxId],
        );
        const order = await client.query<{ id: string; status: string }>(
          `insert into orders (user_id, profile_id, shop_id, source, parse_method, inbound_email_id)
           values ('u', $1, $2, 'email', 'known', $3) returning id, status`,
          [profileId, shopId, email.rows[0]?.id],
        );
        expect(order.rows[0]?.status).toBe("draft");
        const orderId = order.rows[0]?.id;
        await client.query(`insert into order_lines (order_id, name, quantity) values ($1, 'Robe', 1)`, [orderId]);
        await expect(
          client.query(`insert into order_lines (order_id, name, quantity) values ($1, 'Robe', 0)`, [orderId]),
        ).rejects.toThrow(/order_lines_quantity_check/);
        const parcel = await client.query<{ id: string; status: string }>(
          `insert into parcels (order_id, carrier, tracking_number, check_until)
           values ($1, 'colissimo', '6A18537412398', now() + interval '30 days') returning id, status`,
          [orderId],
        );
        expect(parcel.rows[0]?.status).toBe("pending");
        await expect(
          client.query(
            `insert into parcels (order_id, carrier, tracking_number, check_until) values ($1, 'fedex', 'X1', now())`,
            [orderId],
          ),
        ).rejects.toThrow(/parcels_carrier_check/);
        await client.query(
          `insert into parcel_events (parcel_id, at, status, label) values ($1, now(), 'in_transit', 'Pris en charge')`,
          [parcel.rows[0]?.id],
        );

        // Deleting the account removes everything of hers, the shop stays.
        await client.query(`delete from "user" where id = 'u'`);
        const left = await client.query(`select
          (select count(*)::int from order_inboxes) as inboxes,
          (select count(*)::int from inbound_emails) as emails,
          (select count(*)::int from orders) as orders,
          (select count(*)::int from order_lines) as lines,
          (select count(*)::int from parcels) as parcels,
          (select count(*)::int from parcel_events) as steps,
          (select count(*)::int from shops) as shops`);
        expect(left.rows[0]).toEqual({ inboxes: 0, emails: 0, orders: 0, lines: 0, parcels: 0, steps: 0, shops: 1 });
      } finally {
        await client.end();
      }
    } finally {
      await rm(before, { recursive: true, force: true });
      await database.stop();
    }
  }, 120_000);
});
