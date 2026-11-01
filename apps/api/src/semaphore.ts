/** Gives back a slot; calling it twice has no effect. */
export type Release = () => void;

export type Semaphore = {
  /** A slot, or null when none freed up within `waitMs` or too many requests are already waiting. */
  acquire(waitMs: number): Promise<Release | null>;
};

/**
 * Bounds how many expensive operations (photo re-encoding) run at once in this process. Excess callers
 * wait briefly in a bounded queue, first come first served, then give up.
 */
export function createSemaphore({ max, maxWaiting }: { max: number; maxWaiting: number }): Semaphore {
  let active = 0;
  const queue: ((release: Release) => void)[] = [];

  const slot = (): Release => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = queue.shift();
      if (next)
        next(slot()); // hand the slot over: `active` is unchanged
      else active -= 1;
    };
  };

  return {
    acquire(waitMs) {
      if (active < max) {
        active += 1;
        return Promise.resolve(slot());
      }
      if (queue.length >= maxWaiting) return Promise.resolve(null);
      return new Promise((resolve) => {
        const grant = (release: Release) => {
          clearTimeout(timer);
          resolve(release);
        };
        const timer = setTimeout(() => {
          const index = queue.indexOf(grant);
          if (index !== -1) queue.splice(index, 1);
          resolve(null);
        }, waitMs);
        queue.push(grant);
      });
    },
  };
}
