/**
 * Saves the ticks of the order (`inOrderDraft`) one request at a time per item, last wins: a second tap while the first
 * is in flight only updates the wanted state, sent right after. `idle()` waits for every save, so « J'ai commandé »
 * never runs before a tick or an untick reached the server.
 */
export type TickResult<T> = { ok: true; value: T } | { ok: false };

export type TickQueue = {
  /** Wants `id` ticked (or not); `before` is the state it had, put back if the save fails. */
  set(id: string, wanted: boolean, before: boolean): void;
  /** Resolves when nothing is being saved any more. */
  idle(): Promise<void>;
};

export function createTickQueue<T>(
  send: (id: string, wanted: boolean) => Promise<TickResult<T>>,
  onSettled: (id: string, outcome: { ok: true; value: T } | { ok: false; confirmed: boolean }) => void,
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
      })();
    },
    async idle() {
      while (active.size > 0) await Promise.all([...active.values()].map((entry) => entry.promise));
    },
  };
}
