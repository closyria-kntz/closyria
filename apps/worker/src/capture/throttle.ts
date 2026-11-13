/**
 * `shopify`: the request goes to a Shopify-hosted shop, so it also takes a slot of the one Shopify line (one request
 * every 2 s, all shops together). `high` (a link someone pasted, an admin test) is served first, then `medium` (a
 * sheet's refresh), then `low` (catalogue pages, sitemaps, monitors).
 */
export type LinePriority = "high" | "medium" | "low";
export type ThrottleOptions = { shopify?: LinePriority };
const PRIORITIES: readonly LinePriority[] = ["high", "medium", "low"];
export type Throttle = { wait(domain: string, options?: ThrottleOptions): Promise<void> };

const STALE_MS = 60_000;
const MAX_DOMAINS = 10_000;
/** At most one request every 2 s to all the Shopify-hosted shops together (anti-ban, never evaded). */
export const SHOPIFY_INTERVAL_MS = 2000;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One line for every Shopify request of this process: each waiter gets its own slot, `intervalMs` after the previous
 * one; the `high` ones waiting go first, then `medium`, then `low`, each in arrival order.
 */
function createShopifyLine(intervalMs: number, now: () => number, sleep: (ms: number) => Promise<void>) {
  const waiting: Record<LinePriority, (() => void)[]> = { high: [], medium: [], low: [] };
  let last: number | null = null;
  let serving = false;
  const serve = async () => {
    serving = true;
    try {
      for (;;) {
        const line = PRIORITIES.map((priority) => waiting[priority]).find((queue) => queue.length > 0);
        if (!line) return;
        const current = now();
        if (last !== null && current < last + intervalMs) {
          // Someone more urgent may arrive meanwhile: the next one is chosen after the pause.
          await sleep(last + intervalMs - current);
          continue;
        }
        last = current;
        line.shift()?.();
      }
    } finally {
      serving = false;
    }
  };
  return (priority: LinePriority) =>
    new Promise<void>((resolve) => {
      waiting[priority].push(resolve);
      if (!serving) void serve();
    });
}

/**
 * Spaces requests to the same domain by at least `minIntervalMs`; other domains do not wait for each other.
 * Concurrent calls on one domain are queued: each takes the next free slot. A request to a Shopify-hosted shop then
 * also waits for its slot on the Shopify line (`shopifyIntervalMs` between any two, across shops).
 */
export function createThrottle(
  minIntervalMs = 2000,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = defaultSleep,
  // The worker passes SHOPIFY_INTERVAL_MS; `createThrottle(0)` (tests) spaces nothing.
  shopifyIntervalMs = minIntervalMs,
): Throttle {
  // Per domain, the time at which the last reserved slot starts.
  const nextSlot = new Map<string, number>();
  const shopifyLine = createShopifyLine(shopifyIntervalMs, now, sleep);
  const prune = (current: number) => {
    // Re-inserting on each use keeps the map ordered by last use, so the oldest come first.
    for (const [domain, slot] of nextSlot) {
      if (slot >= current - STALE_MS && nextSlot.size <= MAX_DOMAINS) break;
      nextSlot.delete(domain);
    }
  };
  return {
    wait(domain, options) {
      const current = now();
      const previous = nextSlot.get(domain);
      const slot = previous === undefined ? current : Math.max(current, previous + minIntervalMs);
      // Reserve synchronously, before any await, so concurrent callers see it.
      nextSlot.delete(domain);
      nextSlot.set(domain, slot);
      prune(current);
      const priority = options?.shopify;
      // Synchronous up to the line when the domain is free: callers arriving together queue in their call order.
      const onLine = () => (priority ? shopifyLine(priority) : Promise.resolve());
      return slot > current ? sleep(slot - current).then(onLine) : onLine();
    },
  };
}
