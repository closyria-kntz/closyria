import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@closyria/db";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { startTestDatabase } from "./postgres";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");

describe("migration 0021 (catalogue de Découvrir)", () => {
  it("gives sensible defaults and enforces the patterns and the unique report", async () => {
    const database = await startTestDatabase();
    try {
      await runMigrations(database.url, MIGRATIONS_DIR);
      const client = new pg.Client({ connectionString: database.url });
      await client.connect();
      try {
        await client.query(`insert into "user" (id, name, email, email_verified) values ('u', 'A', 'a@t.local', true)`);
        const shop = await client.query<{ id: string; values: string[]; import_enabled: boolean }>(
          `insert into shops (name, slug) values ('S', 's') returning id, values, import_enabled, last_import_at, last_import_error`,
        );
        expect(shop.rows[0]).toMatchObject({ values: [], import_enabled: false, last_import_at: null });
        const shopId = shop.rows[0]?.id;
        await expect(client.query(`update shops set values = '{bio}' where id = $1`, [shopId])).rejects.toThrow(
          /shops_values_check/,
        );
        await client.query(`update shops set values = '{made_in_france,second_hand}' where id = $1`, [shopId]);

        const product = await client.query<{ id: string; category_source: string; hidden_at: Date | null }>(
          `insert into products (shop_id, canonical_url) values ($1, 'https://s.test/p') returning id, category_source, hidden_at, removed_at`,
          [shopId],
        );
        expect(product.rows[0]).toMatchObject({ category_source: "auto", hidden_at: null, removed_at: null });
        const productId = product.rows[0]?.id;
        await expect(
          client.query(`update products set category_source = 'robot' where id = $1`, [productId]),
        ).rejects.toThrow(/products_category_source_check/);

        await client.query(`insert into product_reports (product_id, user_id, reason) values ($1, 'u', 'shocking')`, [
          productId,
        ]);
        await expect(
          client.query(`insert into product_reports (product_id, user_id, reason) values ($1, 'u', 'other')`, [
            productId,
          ]),
        ).rejects.toThrow(/product_reports_product_user_unique/);
        await expect(
          client.query(`update product_reports set reason = 'spam' where product_id = $1`, [productId]),
        ).rejects.toThrow(/product_reports_reason_check/);

        const profile = await client.query<{ size_top: string | null; size_shoes: string | null }>(
          `insert into profiles (user_id, name, audience, color) values ('u', 'P', 'women', 'rose') returning size_top, size_bottom, size_shoes`,
        );
        expect(profile.rows[0]).toMatchObject({ size_top: null, size_shoes: null });
        await expect(client.query(`update profiles set size_top = '12345678901'`)).rejects.toThrow(
          /profiles_size_top_check/,
        );

        await client.query(`delete from "user" where id = 'u'`);
        const left = await client.query(`select 1 from product_reports`);
        expect(left.rowCount).toBe(0);
      } finally {
        await client.end();
      }
    } finally {
      await database.stop();
    }
  }, 60_000);
});
