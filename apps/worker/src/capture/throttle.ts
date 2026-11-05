export type Throttle = { wait(domain: string): Promise<void> };

const STALE_MS = 60_000;
const MAX_DOMAINS = 10_000;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Spaces requests to the same domain by at least `minIntervalMs`; other domains do not wait for
 * each other. Concurrent calls on one domain are queued: each takes the next free slot.
 */
export function createThrottle(
  minIntervalMs = 2000,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Throttle {
  // Per domain, the time at which the last reserved slot starts.
  const nextSlot = new Map<string, number>();
  const prune = (current: number) => {
    // Re-inserting on each use keeps the map ordered by last use, so the oldest come first.
    for (const [domain, slot] of nextSlot) {
      if (slot >= current - STALE_MS && nextSlot.size <= MAX_DOMAINS) break;
      nextSlot.delete(domain);
    }
  };
  return {
    async wait(domain) {
      const current = now();
      const previous = nextSlot.get(domain);
      const slot = previous === undefined ? current : Math.max(current, previous + minIntervalMs);
      // Reserve synchronously, before any await, so concurrent callers see it.
      nextSlot.delete(domain);
      nextSlot.set(domain, slot);
      prune(current);
      if (slot > current) await sleep(slot - current);
    },
  };
}
