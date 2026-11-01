import { findOwnedColumnsWithoutCascade, listOwnedColumns } from "@closyria/auth";
import { createDb } from "@closyria/db";
import { migrateTestDatabase, startTestDatabase, type TestDatabase } from "@closyria/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerOwnedTables } from "./owned-tables";

let database: TestDatabase;
let handle: ReturnType<typeof createDb>;

beforeAll(async () => {
  database = await startTestDatabase();
  await migrateTestDatabase(database.url);
  handle = createDb(database.url, { max: 2 });
}, 60_000);

afterAll(async () => {
  await handle?.pool.end();
  await database?.stop();
});

describe("owned tables of the API process", () => {
  it("registers every table holding user data, each with a cascading foreign key to user(id)", async () => {
    registerOwnedTables();
    registerOwnedTables(); // idempotent
    const tables = listOwnedColumns().map((o) => o.table);
    // Add future owned tables (media, wardrobe, ...) to this list.
    expect(tables.sort()).toEqual(["events", "media", "usage_counters", "user_plans"]);
    expect(await findOwnedColumnsWithoutCascade(handle.db)).toEqual([]);
  });
});
