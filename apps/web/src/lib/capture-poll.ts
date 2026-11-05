import type { CaptureView } from "@closyria/shared";

export type PollOptions<T> = {
  intervalMs?: number;
  softTimeoutMs?: number;
  /** After the soft timeout, polling slows down to this interval... */
  slowIntervalMs?: number;
  /** ...and gives up this long after it. */
  slowDurationMs?: number;
  /** Each request is aborted after this long (and when polling is cancelled). */
  requestTimeoutMs?: number;
  onUpdate?: (value: T) => void;
  onSoftTimeout?: () => void;
  /** Called once when polling stops without having seen a final value. */
  onGiveUp?: () => void;
};

/**
 * Polls `fetchOnce` until `isFinal` says so. After `softTimeoutMs`, `onSoftTimeout` fires once and polling
 * continues every 3 s; 60 s later `onGiveUp` fires and polling stops. A failed or timed-out request is retried.
 * Returns a cancel function, which also aborts the request in flight.
 */
export function pollUntil<T>(
  fetchOnce: (signal: AbortSignal) => Promise<T>,
  isFinal: (value: T) => boolean,
  {
    intervalMs = 500,
    softTimeoutMs = 15_000,
    slowIntervalMs = 3_000,
    slowDurationMs = 60_000,
    requestTimeoutMs = 10_000,
    onUpdate,
    onSoftTimeout,
    onGiveUp,
  }: PollOptions<T> = {},
): () => void {
  const startedAt = Date.now();
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: AbortController | undefined;
  let softFired = false;

  const tick = async () => {
    const controller = new AbortController();
    inFlight = controller;
    const abortTimer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const value = await fetchOnce(controller.signal);
      if (cancelled) return;
      onUpdate?.(value);
      if (isFinal(value)) return;
    } catch {
      if (cancelled) return;
      // A failed request is not the end: try again.
    } finally {
      clearTimeout(abortTimer);
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed >= softTimeoutMs && !softFired) {
      softFired = true;
      onSoftTimeout?.();
    }
    if (softFired && elapsed >= softTimeoutMs + slowDurationMs) return onGiveUp?.();
    timer = setTimeout(tick, softFired ? slowIntervalMs : intervalMs);
  };

  timer = setTimeout(tick, 0);
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    inFlight?.abort();
  };
}

const FINAL = new Set<CaptureView["status"]>(["succeeded", "failed", "skipped_manual"]);

/** Follows a capture. Stops only on a final status (ruling R4): `dataReady` merely drives what is shown. */
export function pollCapture(
  id: string,
  fetchCapture: (id: string, signal?: AbortSignal) => Promise<CaptureView>,
  options: PollOptions<CaptureView> = {},
): () => void {
  return pollUntil(
    (signal) => fetchCapture(id, signal),
    (view) => FINAL.has(view.status),
    options,
  );
}
