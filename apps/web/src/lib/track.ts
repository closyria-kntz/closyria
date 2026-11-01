import type { AudienceEvent, EventName } from "@closyria/shared";
import { MAX_EVENTS_PER_BATCH } from "@closyria/shared";

type Props = NonNullable<AudienceEvent["props"]>;

/** Everything the tracker needs from the browser, so it can be tested without one. */
export type TrackerEnv = {
  endpoint: string;
  /** Path of the current page (the server also drops any query string). */
  path: () => string;
  now: () => Date;
  /** True when the visitor asked not to be measured. */
  optedOut: () => boolean;
  /** `navigator.sendBeacon`: true when the browser queued the request. */
  beacon: (url: string, body: string) => boolean;
  /** Fallback: `fetch` with `keepalive`. */
  post: (url: string, body: string) => Promise<unknown>;
  setTimer: (fn: () => void, delayMs: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Calls `fn` each time the page becomes hidden. */
  onHidden: (fn: () => void) => void;
};

const FLUSH_DELAY_MS = 2000;

export function createTracker(env: TrackerEnv) {
  let queue: AudienceEvent[] = [];
  let timer: unknown;

  function flush() {
    if (timer !== undefined) env.clearTimer(timer);
    timer = undefined;
    if (queue.length === 0) return;
    const body = JSON.stringify({ events: queue });
    queue = [];
    // Audience measurement never gets in the way of the page: a lost batch is lost.
    try {
      if (!env.beacon(env.endpoint, body)) env.post(env.endpoint, body).catch(() => {});
    } catch {}
  }

  env.onHidden(flush);

  function track(name: EventName, props?: Props, path?: string) {
    if (env.optedOut()) return;
    queue.push({
      name,
      path: path ?? env.path(),
      occurredAt: env.now().toISOString(),
      ...(props ? { props } : {}),
    });
    if (queue.length >= MAX_EVENTS_PER_BATCH) flush();
    else timer ??= env.setTimer(flush, FLUSH_DELAY_MS);
  }

  return { track, flush };
}

/**
 * Honors Global Privacy Control and Do Not Track: with either on, nothing is sent at all (stricter than the
 * CNIL exemption requires, and it keeps the measurement trivially defensible).
 */
const browserOptedOut = () =>
  (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true ||
  navigator.doNotTrack === "1";

let browserTracker: ReturnType<typeof createTracker> | undefined;

/**
 * Calls `fn` when the page is hidden (`visibilitychange`) or left (`pagehide`: Safari does not always fire the
 * former when a tab closes). Both may fire for one departure; flushing an empty queue is a no-op.
 */
export function bindFlushEvents(
  doc: Pick<EventTarget, "addEventListener"> & { visibilityState: string },
  win: Pick<EventTarget, "addEventListener">,
  fn: () => void,
): void {
  doc.addEventListener("visibilitychange", () => {
    if (doc.visibilityState === "hidden") fn();
  });
  win.addEventListener("pagehide", fn);
}

/**
 * Records an audience event (batched, sent with `sendBeacon`). Does nothing on the server.
 * PRIVACY: the path must never carry personal data. Pass a route template (`/items/[id]`) as `path` when the
 * URL holds identifiers; the default is the current pathname, fine for static routes only. Query strings are
 * not sent by the default and are dropped by the server anyway.
 */
export function track(name: EventName, props?: Props, path?: string): void {
  if (typeof window === "undefined") return;
  try {
    trackInBrowser(name, props, path);
  } catch {} // audience measurement never throws into the page
}

function trackInBrowser(name: EventName, props?: Props, path?: string): void {
  browserTracker ??= createTracker({
    endpoint: "/api/events",
    path: () => window.location.pathname,
    now: () => new Date(),
    optedOut: browserOptedOut,
    beacon: (url, body) =>
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" })),
    post: (url, body) =>
      fetch(url, { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }),
    setTimer: (fn, delayMs) => window.setTimeout(fn, delayMs),
    clearTimer: (handle) => window.clearTimeout(handle as number),
    onHidden: (fn) => bindFlushEvents(document, window, fn),
  });
  browserTracker.track(name, props, path);
}
