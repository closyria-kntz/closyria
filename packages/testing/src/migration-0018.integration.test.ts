import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@closyria/db";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { startTestDatabase } from "./postgres";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");

describe("migration 0018 (acheter ensemble)", () => {
  it("keeps one running group order per list, checks lines, cascades shipping options", async () => {
    const database = await startTestDatabase();
    try {
      await runMigrations(database.url, MIGRATIONS_DIR);
      const client = new pg.Client({ connectionString: database.url });
      await client.connect();
      try {
        await client.query(
          `insert into "user" (id, name, email, email_verified) values ('u1', 'U', 'u@t.local', true)`,
        );
        const list = await client.query<{ id: string }>(
          `insert into wishlists (user_id, name) values ('u1', 'L') returning id`,
        );
        const wishlistId = list.rows[0]?.id;
        const shop = await client.query<{ id: string }>(
          `insert into shops (name, slug) values ('Zara', 'zara') returning id`,
        );
        const shopId = shop.rows[0]?.id;
        const order = async (status: string) =>
          (
            await client.query<{ id: string }>(
              `insert into group_orders (wishlist_id, shop_id, status, shipping_label, shipping_cents, currency)
               values ($1, $2, $3, 'Standard', 690, 'EUR') returning id`,
              [wishlistId, shopId, status],
            )
          ).rows[0]?.id;

        const openId = await order("open");
        await expect(order("open")).rejects.toThrow(/unique|duplicate/i);
        await expect(order("closed")).rejects.toThrow(/unique|duplicate/i);
        await expect(order("weird")).rejects.toThrow(/check/i);
        await order("ordered");
        await order("cancelled");

        const line = (quantity: number, name: string | null) =>
          client.query(
            `insert into group_order_lines (group_order_id, buyer_name, buyer_name_key, manual_name, manual_price_cents, quantity)
             values ($1, 'Léa', 'léa', $2, 1000, $3)`,
            [openId, name, quantity],
          );
        await line(2, "Robe");
        await expect(line(0, "Robe")).rejects.toThrow(/check/i);
        await expect(line(6, "Robe")).rejects.toThrow(/check/i);
        await expect(line(1, null)).rejects.toThrow(/check/i);

        const profile = await client.query<{ id: string }>(
          `insert into profiles (user_id, name, audience, color) values ('u1', 'P', 'women', 'rose') returning id`,
        );
        const mkItem = async () =>
          (
            await client.query<{ id: string }>(
              `insert into items (user_id, profile_id) values ('u1', $1) returning id`,
              [profile.rows[0]?.id],
            )
          ).rows[0]?.id;
        const product = await client.query<{ id: string }>(
          `insert into products (shop_id, canonical_url) values ($1, 'https://zara.example/p/1') returning id`,
          [shopId],
        );
        const itemId = await mkItem();
        // An item-only line is refused: deleting the item would break the source check.
        await expect(
          client.query(`insert into group_order_lines (group_order_id, item_id) values ($1, $2)`, [openId, itemId]),
        ).rejects.toThrow(/check/i);
        await client.query(`insert into group_order_lines (group_order_id, item_id, product_id) values ($1, $2, $3)`, [
          openId,
          itemId,
          product.rows[0]?.id,
        ]);
        await client.query("delete from items where id = $1", [itemId]);
        const kept = await client.query<{ item_id: string | null }>(
          `select item_id from group_order_lines where product_id = $1`,
          [product.rows[0]?.id],
        );
        expect(kept.rowCount).toBe(1);
        expect(kept.rows[0]?.item_id).toBeNull();

        const option = await client.query<{ id: string }>(
          `insert into shop_shipping_options (shop_id, label, shipping_cents) values ($1, 'Standard', 690) returning id`,
          [shopId],
        );
        expect(option.rowCount).toBe(1);
        await expect(
          client.query(
            `insert into shop_shipping_options (shop_id, label, shipping_cents, free_from_cents) values ($1, 'X', 100, 0)`,
            [shopId],
          ),
        ).rejects.toThrow(/check/i);

        await client.query(
          `insert into group_order_payments (group_order_id, buyer_name_key, buyer_name, amount_cents) values ($1, 'léa', 'Léa', 2690)`,
          [openId],
        );
        await expect(
          client.query(
            `insert into group_order_payments (group_order_id, buyer_name_key, buyer_name, amount_cents) values ($1, 'léa', 'Léa', 1)`,
            [openId],
          ),
        ).rejects.toThrow(/unique|duplicate/i);

        await client.query(`delete from group_orders where wishlist_id = $1`, [wishlistId]);
        const orphans = await client.query(`select 1 from group_order_lines`);
        expect(orphans.rowCount).toBe(0);

        await client.query("delete from products where shop_id = $1", [shopId]);
        await client.query("delete from shops where id = $1", [shopId]);
        const left = await client.query("select 1 from shop_shipping_options");
        expect(left.rowCount).toBe(0);
      } finally {
        await client.end();
      }
    } finally {
      await database.stop();
    }
  }, 60_000);
});
