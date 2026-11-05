import type { CaptureView } from "@closyria/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollCapture, pollUntil } from "./capture-poll";

const view = (over: Partial<CaptureView>): CaptureView => ({
  id: "00000000-0000-4000-8000-000000000001",
  status: "running",
  dataReady: false,
  errorCode: null,
  product: null,
  ...over,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("pollCapture", () => {
  it("polls every 500 ms and stops on succeeded", async () => {
    const answers = [view({}), view({ dataReady: true }), view({ status: "succeeded", dataReady: true })];
    const fetchCapture = vi.fn(async () => answers[Math.min(fetchCapture.mock.calls.length - 1, 2)] as CaptureView);
    const onUpdate = vi.fn();
    pollCapture("id", fetchCapture, { onUpdate });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchCapture).toHaveBeenCalledTimes(3);
    expect(onUpdate).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchCapture).toHaveBeenCalledTimes(3);
  });

  it.each(["failed", "skipped_manual"] as const)("stops on %s", async (status) => {
    const fetchCapture = vi.fn(async () => view({ status }));
    pollCapture("id", fetchCapture, {});
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchCapture).toHaveBeenCalledTimes(1);
  });

  it("keeps polling after dataReady while the capture is still running (ruling R4)", async () => {
    const fetchCapture = vi.fn(async () => view({ dataReady: true }));
    pollCapture("id", fetchCapture, {});
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchCapture.mock.calls.length).toBeGreaterThan(3);
  });

  it("calls onSoftTimeout after 15 s, then polls every 3 s for 60 s at most", async () => {
    const fetchCapture = vi.fn(async () => view({}));
    const onSoftTimeout = vi.fn();
    pollCapture("id", fetchCapture, { onSoftTimeout });
    await vi.advanceTimersByTimeAsync(14_900);
    expect(onSoftTimeout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(onSoftTimeout).toHaveBeenCalledTimes(1);

    const before = fetchCapture.mock.calls.length;
    await vi.advanceTimersByTimeAsync(9_000);
    expect(fetchCapture.mock.calls.length - before).toBe(3);

    await vi.advanceTimersByTimeAsync(120_000);
    const total = fetchCapture.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchCapture.mock.calls.length).toBe(total);
    expect(onSoftTimeout).toHaveBeenCalledTimes(1);
  });

  it("keeps going when a request fails", async () => {
    const fetchCapture = vi
      .fn<() => Promise<CaptureView>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(view({ status: "succeeded" }));
    const onUpdate = vi.fn();
    pollCapture("id", fetchCapture, { onUpdate });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("can be cancelled", async () => {
    const fetchCapture = vi.fn(async () => view({}));
    const cancel = pollCapture("id", fetchCapture, {});
    await vi.advanceTimersByTimeAsync(1_000);
    cancel();
    const calls = fetchCapture.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchCapture.mock.calls.length).toBe(calls);
  });

  it("gives up once, after the soft timeout plus 60 s, while the capture is still running", async () => {
    const fetchCapture = vi.fn(async () => view({}));
    const onGiveUp = vi.fn();
    pollCapture("id", fetchCapture, { onGiveUp });
    await vi.advanceTimersByTimeAsync(74_000);
    expect(onGiveUp).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it("does not give up after a final status or a cancel", async () => {
    const onGiveUp = vi.fn();
    pollCapture(
      "id",
      vi.fn(async () => view({ status: "failed" })),
      { onGiveUp },
    );
    const cancel = pollCapture(
      "id",
      vi.fn(async () => view({})),
      { onGiveUp },
    );
    await vi.advanceTimersByTimeAsync(5_000);
    cancel();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("aborts a request that hangs for 10 s and carries on", async () => {
    const signals: AbortSignal[] = [];
    const fetchCapture = vi.fn(
      (_id: string, signal?: AbortSignal) =>
        new Promise<CaptureView>((resolve, reject) => {
          if (signals.length === 1) return resolve(view({ status: "succeeded" }));
          signals.push(signal as AbortSignal);
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const onUpdate = vi.fn();
    pollCapture("id", fetchCapture, { onUpdate });
    await vi.advanceTimersByTimeAsync(9_000);
    expect(signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(signals[0]?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("aborts the in-flight request when cancelled", async () => {
    let signal: AbortSignal | undefined;
    const fetchCapture = vi.fn((_id: string, s?: AbortSignal) => {
      signal = s;
      return new Promise<CaptureView>(() => {});
    });
    const cancel = pollCapture("id", fetchCapture, {});
    await vi.advanceTimersByTimeAsync(100);
    cancel();
    expect(signal?.aborted).toBe(true);
  });
});

describe("pollUntil", () => {
  it("polls any resource until it is final, with the same schedule and give-up", async () => {
    const fetchOnce = vi.fn(async () => ({ pending: true }));
    const onSoftTimeout = vi.fn();
    const onGiveUp = vi.fn();
    pollUntil(fetchOnce, (v) => !v.pending, { onSoftTimeout, onGiveUp });
    await vi.advanceTimersByTimeAsync(15_100);
    expect(onSoftTimeout).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it("stops as soon as the resource is final", async () => {
    const fetchOnce = vi.fn(async () => ({ pending: false }));
    pollUntil(fetchOnce, (v) => !v.pending, {});
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchOnce).toHaveBeenCalledTimes(1);
  });
});
