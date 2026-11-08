/**
 * Saves the ticks of the order (`inOrderDraft`) one request at a time per item, last wins: a second tap while the first
 * is in flight only updates the wanted state, sent right after. `idle()` waits for every save, so « J'ai commandé »
 * never runs before a tick or an untick reached the server. `onBusyChange` says when saving starts and stops (once for
 * several wishes): a live refresh waits meanwhile, so it never reads a wish before its tick is saved and puts it back.
 */
export type TickResult<T> = { ok: true; value: T } | { ok: false };

export type TickQueue = {
  /** Wants `id` ticked (or not); `before` is the state it had, put back if the save fails. */
  set(id: string, wanted: boolean, before: boolean): void;
  /** Resolves when nothing is being saved any more. */
  idle(): Promise<void>;
  /** True while a tick or an untick is being saved. */
  busy(): boolean;
};

export function createTickQueue<T>(
  send: (id: string, wanted: boolean) => Promise<TickResult<T>>,
  onSettled: (id: string, outcome: { ok: true; value: T } | { ok: false; confirmed: boolean }) => void,
  onBusyChange?: (busy: boolean) => void,
): TickQueue {
  const active = new Map<string, { wanted: boolean; promise: Promise<void> }>();
  return {
    set(id, wanted, before) {
      const running = active.get(id);
      if (running) {
        running.wanted = wanted;
        return;
      }
      const entry = { wanted, promise: Promise.resolve() };
      active.set(id, entry);
      if (active.size === 1) onBusyChange?.(true);
      entry.promise = (async () => {
        let confirmed = before;
        let result: TickResult<T>;
        let sent: boolean;
        do {
          sent = entry.wanted;
          result = await send(id, sent);
          if (result.ok) confirmed = sent;
        } while (result.ok && entry.wanted !== sent);
        active.delete(id);
        onSettled(id, result.ok ? result : { ok: false, confirmed });
        if (active.size === 0) onBusyChange?.(false);
      })();
    },
    async idle() {
      while (active.size > 0) await Promise.all([...active.values()].map((entry) => entry.promise));
    },
    busy() {
      return active.size > 0;
    },
  };
}
