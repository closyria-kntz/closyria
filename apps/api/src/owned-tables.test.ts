import { findOwnedColumnsWithoutCascade, listOwnedColumns } from "@closyria/auth";
import { sql } from "@closyria/db";
import type { TestDatabase } from "@closyria/testing";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Api, bootstrap } from "./bootstrap";
import { envSchema } from "./env";

/**
 * Foreign keys to user(id) that are deliberately NOT owned tables (their rows are not moved on account
 * linking). Any other foreign key to user(id) must be registered in owned-tables.ts.
 */
const NOT_OWNED: Record<string, string> = {
  // Better Auth's own tables: the anonymous user's sessions, accounts and passkeys are deleted with her.
  "account.user_id": "Better Auth",
  "session.user_id": "Better Auth",
  "passkey.user_id": "Better Auth",
  // R16: the audit log outlives the admin account (ON DELETE SET NULL) and holds no user content.
  "admin_audit_log.admin_id": "R16",
  // Capture log: an operational record that outlives the user (ON DELETE SET NULL) and holds no user content.
  "captures.requested_by": "capture log: outlives the user (ON DELETE SET NULL), no user content",
};

let database: TestDatabase;
let api: Api;

beforeAll(async () => {
  database = await createTestDatabase();
  // The production bootstrap (index.ts), so deleting its registration call turns this test red.
  api = bootstrap(
    envSchema.parse({
      DATABASE_URL: database.url,
      BETTER_AUTH_SECRET: "a".repeat(32),
      BETTER_AUTH_URL: "http://localhost:3001",
    }),
  );
}, 60_000);

afterAll(async () => {
  await api?.pool.end();
  await database?.stop();
});

describe("owned tables of the API process", () => {
  it("registers every table holding user data, each with a cascading foreign key to user(id)", async () => {
    const tables = listOwnedColumns().map((o) => o.table);
    expect(tables.sort()).toEqual([
      "events",
      "items",
      "media",
      "profiles",
      "tags",
      "usage_counters",
      "user_plans",
      "wishlists",
    ]);
    expect(await findOwnedColumnsWithoutCascade(api.db)).toEqual([]);
  });

  it("merges the wardrobe in an order where every step sees its parents already moved", () => {
    // Registration order is execution order (wardrobe/merge.ts relies on it).
    const order = listOwnedColumns()
      .map((o) => o.table)
      .filter((t) => ["media", "profiles", "tags", "items", "wishlists"].includes(t));
    expect(order).toEqual(["media", "profiles", "tags", "items", "wishlists"]);
  });

  it("leaves no foreign key to user(id) unregistered, except the explicit allowlist", async () => {
    const result = await api.db.execute<{ fk: string }>(sql`
      select c.conrelid::regclass::text || '.' || a.attname as fk
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.contype = 'f' and c.confrelid = '"user"'::regclass`);
    const owned = new Set(listOwnedColumns().map(({ table, column }) => `${table}.${column}`));
    const foreignKeys = result.rows.map((r) => r.fk.replaceAll('"', ""));
    expect(foreignKeys.filter((fk) => !owned.has(fk) && !(fk in NOT_OWNED))).toEqual([]);
    // The allowlist stays exact: an entry whose foreign key disappeared must be removed.
    expect(Object.keys(NOT_OWNED).filter((fk) => !foreignKeys.includes(fk))).toEqual([]);
  });
});
