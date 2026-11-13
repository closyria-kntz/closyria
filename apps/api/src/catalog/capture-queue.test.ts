import { describe, expect, it } from "vitest";
import { pgBossQueue } from "./capture-queue";

function fakeBoss(failStart = 0, taken = new Set<string>()) {
  const log: string[] = [];
  let failures = failStart;
  return {
    log,
    boss: {
      start: async () => {
        log.push("start");
        if (failures-- > 0) throw new Error("down");
        return undefined as never;
      },
      createQueue: async (name: string, options?: object) =>
        void log.push(`create ${name}${options ? ` ${JSON.stringify(options)}` : ""}`),
      send: async (
        name: string,
        data?: object | null,
        options?: { singletonKey: string; singletonSeconds?: number },
      ) => {
        log.push(`send ${name} ${JSON.stringify(data)}${options ? ` ${JSON.stringify(options)}` : ""}`);
        return taken.has(options?.singletonKey ?? "") ? null : "job";
      },
    },
  };
}

describe("pgBossQueue", () => {
  it("starts once, creates its queues, then sends the capture or import id", async () => {
    const { boss, log } = fakeBoss();
    const queue = pgBossQueue(boss);
    await queue.enqueue("capture-user", "c1");
    await queue.enqueue("capture-admin", "c2");
    await queue.enqueue("photo-import", "i1");
    expect(log).toEqual([
      "start",
      "create capture-user",
      "create capture-admin",
      "create capture-refresh",
      "create photo-import",
      'create catalogue-import {"policy":"exclusive","retryLimit":0,"expireInSeconds":21600}',
      'send capture-user {"captureId":"c1"}',
      'send capture-admin {"captureId":"c2"}',
      'send photo-import {"importId":"i1"}',
    ]);
  });

  it("queues a shop's catalogue import with the shop as singleton key; false when one is already queued", async () => {
    const { boss, log } = fakeBoss(0, new Set(["busy"]));
    const queue = pgBossQueue(boss);
    expect(await queue.importCatalogue("s1")).toBe(true);
    expect(await queue.importCatalogue("busy")).toBe(false);
    expect(log.slice(-2)).toEqual([
      'send catalogue-import {"shopId":"s1","manual":true} {"singletonKey":"s1"}',
      'send catalogue-import {"shopId":"busy","manual":true} {"singletonKey":"busy"}',
    ]);
  });

  it("sends a sheet's refresh on its own queue, one per product every 15 min; false when the window has one", async () => {
    const { boss, log } = fakeBoss(0, new Set(["busy-product"]));
    const queue = pgBossQueue(boss);
    expect(await queue.refreshProduct("p1", "c1")).toBe(true);
    expect(await queue.refreshProduct("busy-product", "c2")).toBe(false);
    expect(log.slice(-2)).toEqual([
      'send capture-refresh {"captureId":"c1"} {"singletonKey":"p1","singletonSeconds":900}',
      'send capture-refresh {"captureId":"c2"} {"singletonKey":"busy-product","singletonSeconds":900}',
    ]);
  });

  it("retries the start on the next capture after a failure", async () => {
    const { boss, log } = fakeBoss(1);
    const queue = pgBossQueue(boss);
    await expect(queue.enqueue("capture-user", "c1")).rejects.toThrow("down");
    await queue.enqueue("capture-user", "c1");
    expect(log.filter((l) => l === "start")).toHaveLength(2);
    expect(log.at(-1)).toBe('send capture-user {"captureId":"c1"}');
  });
});
