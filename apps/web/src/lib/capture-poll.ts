import type { CaptureView } from "@closyria/shared";

export type PollOptions = {
  intervalMs?: number;
  softTimeoutMs?: number;
  /** After the soft timeout, polling slows down to this interval... */
  slowIntervalMs?: number;
  /** ...and stops this long after it. */
  slowDurationMs?: number;
  onUpdate?: (view: CaptureView) => void;
  onSoftTimeout?: () => void;
};

const FINAL = new Set<CaptureView["status"]>(["succeeded", "failed", "skipped_manual"]);

/**
 * Follows a capture. Stops only on a final status (ruling R4): `dataReady` merely drives what is shown.
 * After `softTimeoutMs`, `onSoftTimeout` fires once and polling continues every 3 s for at most 60 s more.
 * Returns a cancel function.
 */
export function pollCapture(
  id: string,
  fetchCapture: (id: string) => Promise<CaptureView>,
  {
    intervalMs = 500,
    softTimeoutMs = 15_000,
    slowIntervalMs = 3_000,
    slowDurationMs = 60_000,
    onUpdate,
    onSoftTimeout,
  }: PollOptions = {},
): () => void {
  const startedAt = Date.now();
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let softFired = false;

  const tick = async () => {
    try {
      const view = await fetchCapture(id);
      if (cancelled) return;
      onUpdate?.(view);
      if (FINAL.has(view.status)) return;
    } catch {
      if (cancelled) return;
      // A failed request is not the end of the capture: try again.
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed >= softTimeoutMs && !softFired) {
      softFired = true;
      onSoftTimeout?.();
    }
    if (softFired && elapsed >= softTimeoutMs + slowDurationMs) return;
    timer = setTimeout(tick, softFired ? slowIntervalMs : intervalMs);
  };

  timer = setTimeout(tick, 0);
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
