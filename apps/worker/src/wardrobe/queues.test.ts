import type { Database } from "@closyria/db";
import { memoryStore } from "@closyria/storage";
import type { PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";
import { PURGE_QUEUE, purgeHandler, registerWardrobeQueues } from "./queues";

describe("wardrobe queues", () => {
  it("creates wardrobe-purge, processes it and schedules it at 03:30", async () => {
    const calls: unknown[][] = [];
    const boss = {
      createQueue: vi.fn(async () => {}),
      work: vi.fn(async () => "id"),
      schedule: vi.fn(async (...args: unknown[]) => {
        calls.push(args);
      }),
    } as unknown as PgBoss;
    await registerWardrobeQueues(boss, { db: {} as Database, store: memoryStore() });
    expect(PURGE_QUEUE).toBe("wardrobe-purge");
    expect(boss.createQueue).toHaveBeenCalledWith("wardrobe-purge");
    expect(calls).toEqual([["wardrobe-purge", "30 3 * * *"]]);
  });

  it("fails a job that carries data", async () => {
    const run = vi.fn(async () => 0);
    const handler = purgeHandler(run);
    await handler([{ data: undefined }, { data: {} }, { data: null }]);
    expect(run).toHaveBeenCalledTimes(3);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(handler([{ id: "j", data: { x: 1 } }])).rejects.toThrow("invalid job data");
    error.mockRestore();
    expect(run).toHaveBeenCalledTimes(3);
  });
});
