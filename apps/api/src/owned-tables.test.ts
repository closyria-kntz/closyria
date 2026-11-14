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
  // Catalogue reports: one per person and article (unique), so moving them on linking could collide; an anonymous
  // account's reports are deleted with her (ON DELETE CASCADE), which loses nothing the admin needs.
  "product_reports.user_id": "catalogue report: not moved on linking (unique per person and article), cascades",
  "captures.requested_by": "capture log: outlives the user (ON DELETE SET NULL), no user content",
  // Alerts: notifications need an account (a guest cannot subscribe), so these never belong to an anonymous user;
  // the send log is an operational record for the dashboard.
  "push_subscriptions.user_id": "alerts: account only (guest refused with account_required)",
  "alert_settings.user_id": "alerts: account only, one row per account",
  "alert_sends.user_id": "alerts: send log for the dashboard, no user content",
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
      SHARE_LINK_KEY: Buffer.alloc(32, 7).toString("base64"),
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
      "alert_events",
      "budgets",
      "events",
      "items",
      "love_levels",
      "media",
      "photo_imports",
      "profiles",
      "recent_products",
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
      .filter((t) =>
        ["media", "profiles", "tags", "items", "photo_imports", "recent_products", "wishlists", "budgets"].includes(t),
      );
    expect(order).toEqual([
      "media",
      "profiles",
      "tags",
      "items",
      "photo_imports",
      "recent_products",
      "wishlists",
      "budgets",
    ]);
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
