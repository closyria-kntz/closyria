export type Throttle = { wait(domain: string): Promise<void> };

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
  return {
    async wait(domain) {
      const current = now();
      const previous = nextSlot.get(domain);
      const slot = previous === undefined ? current : Math.max(current, previous + minIntervalMs);
      // Reserve synchronously, before any await, so concurrent callers see it.
      nextSlot.set(domain, slot);
      if (slot > current) await sleep(slot - current);
    },
  };
}
