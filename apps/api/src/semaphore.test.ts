import { afterEach, describe, expect, it, vi } from "vitest";
import { createSemaphore } from "./semaphore";

afterEach(() => {
  vi.useRealTimers();
});

describe("createSemaphore", () => {
  it("grants up to max at once, then hands a released slot to the next waiter", async () => {
    const semaphore = createSemaphore({ max: 2, maxWaiting: 4 });
    const a = await semaphore.acquire(1000);
    const b = await semaphore.acquire(1000);
    expect(a && b).toBeTruthy();
    const waiting = semaphore.acquire(1000);
    let granted = false;
    void waiting.then(() => {
      granted = true;
    });
    await Promise.resolve();
    expect(granted).toBe(false);
    a?.();
    expect(await waiting).toBeTypeOf("function");
  });

  it("gives up after waitMs and returns null", async () => {
    vi.useFakeTimers();
    const semaphore = createSemaphore({ max: 1, maxWaiting: 4 });
    const held = await semaphore.acquire(0);
    const late = semaphore.acquire(500);
    vi.advanceTimersByTime(500);
    expect(await late).toBeNull();
    held?.();
    // The timed-out waiter left the queue: the slot is free again.
    expect(await semaphore.acquire(0)).toBeTypeOf("function");
  });

  it("refuses at once when too many are already waiting", async () => {
    const semaphore = createSemaphore({ max: 1, maxWaiting: 1 });
    const held = await semaphore.acquire(0);
    const queued = semaphore.acquire(10_000);
    expect(await semaphore.acquire(10_000)).toBeNull();
    held?.();
    (await queued)?.();
  });

  it("ignores a second release of the same slot", async () => {
    const semaphore = createSemaphore({ max: 1, maxWaiting: 0 });
    const release = await semaphore.acquire(0);
    release?.();
    release?.();
    const again = await semaphore.acquire(0);
    expect(again).toBeTypeOf("function");
    expect(await semaphore.acquire(0)).toBeNull(); // still only one slot
  });
});
