import { describe, expect, it } from "vitest";
import { pgBossQueue } from "./capture-queue";

function fakeBoss(failStart = 0) {
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
      createQueue: async (name: string) => void log.push(`create ${name}`),
      send: async (name: string, data?: object | null) => {
        log.push(`send ${name} ${JSON.stringify(data)}`);
        return "job";
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
      "create photo-import",
      'send capture-user {"captureId":"c1"}',
      'send capture-admin {"captureId":"c2"}',
      'send photo-import {"importId":"i1"}',
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
