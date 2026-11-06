import type { Database } from "@closyria/db";
import { memoryStore } from "@closyria/storage";
import type { PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";
import { PURGE_QUEUE, photoImportHandler, purgeHandler, registerWardrobeQueues } from "./queues";

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
    expect(boss.work).toHaveBeenCalledWith("wardrobe-purge", expect.any(Function));
    expect(calls).toEqual([["wardrobe-purge", "30 3 * * *"]]);
    expect(boss.createQueue).toHaveBeenCalledWith("photo-import");
    expect(boss.work).toHaveBeenCalledWith("photo-import", { localConcurrency: 2 }, expect.any(Function));
  });

  it("photo-import runs each valid job and fails one with invalid data", async () => {
    const run = vi.fn(async () => {});
    const handler = photoImportHandler(run);
    const id = "7b1f6a52-3a0b-4a4c-9f0e-5b1c2d3e4f50";
    await handler([{ data: { importId: id } }]);
    expect(run).toHaveBeenCalledWith(id);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(handler([{ id: "j", data: { importId: "nope" } }])).rejects.toThrow("invalid job data");
    error.mockRestore();
    expect(run).toHaveBeenCalledTimes(1);
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
