import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@closyria/db";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { startTestDatabase } from "./postgres";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");

describe("migrations 0044 and 0045 (adresses d'envoi)", () => {
  it("keeps one row per address and account, lowercase, no code once verified, removed with the account", async () => {
    const database = await startTestDatabase();
    try {
      await runMigrations(database.url, MIGRATIONS_DIR);
      const client = new pg.Client({ connectionString: database.url });
      await client.connect();
      try {
        for (const id of ["u", "v"]) {
          await client.query(
            `insert into "user" (id, name, email, email_verified, role) values ($1, 'U', $2, true, 'user')`,
            [id, `${id}@t.local`],
          );
        }
        const add = (user: string, email: string) =>
          client.query(`insert into order_sender_addresses (user_id, email) values ($1, $2)`, [user, email]);
        await add("u", "marie@hotmail.example");
        // The same address on another account is allowed (sorted by the order address).
        await add("v", "marie@hotmail.example");
        await expect(add("u", "marie@hotmail.example")).rejects.toThrow(/order_sender_addresses_user_id_email_idx/);
        await expect(add("u", "Marie@Hotmail.example")).rejects.toThrow(/order_sender_addresses_email_check/);
        await expect(add("u", "a")).rejects.toThrow(/order_sender_addresses_email_check/);
        await expect(
          client.query(
            `insert into order_sender_addresses (user_id, email, verified_at, code_hash, code_salt, code_expires_at)
             values ('u', 'b@x.example', now(), 'h', 's', now())`,
          ),
        ).rejects.toThrow(/order_sender_addresses_code_check/);
        await expect(
          client.query(`insert into order_sender_addresses (user_id, email, attempts) values ('u', 'c@x.example', -1)`),
        ).rejects.toThrow(/order_sender_addresses_attempts_check/);
        await client.query(`insert into order_sender_sends (user_id, window_start, sends) values ('u', now(), 1)`);

        // 0045: one count per target address (its hash), none of an account's.
        await client.query(`insert into order_sender_code_targets (key, window_start, sends) values ('k', now(), 1)`);
        await expect(
          client.query(`insert into order_sender_code_targets (key, window_start, sends) values ('k', now(), 1)`),
        ).rejects.toThrow(/order_sender_code_targets_pkey/);

        await client.query(`delete from "user" where id = 'u'`);
        const left = await client.query<{ user_id: string }>(
          `select user_id from order_sender_addresses union all select user_id from order_sender_sends`,
        );
        expect(left.rows).toEqual([{ user_id: "v" }]);
      } finally {
        await client.end();
      }
    } finally {
      await database.stop();
    }
  }, 120_000);
});
