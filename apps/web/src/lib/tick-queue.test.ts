import { describe, expect, it } from "vitest";
import { createTickQueue, type TickResult } from "./tick-queue";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe("createTickQueue", () => {
  it("sends the last wanted state after the first save, one request at a time", async () => {
    const sent: boolean[] = [];
    const gate = deferred();
    const settled: unknown[] = [];
    const queue = createTickQueue<string>(
      async (_id, wanted) => {
        sent.push(wanted);
        if (sent.length === 1) await gate.promise;
        return { ok: true, value: `saved-${wanted}` } satisfies TickResult<string>;
      },
      (_id, outcome) => settled.push(outcome),
    );
    queue.set("a", false, true);
    queue.set("a", true, false);
    queue.set("a", false, true);
    gate.resolve();
    await queue.idle();
    // Unticked, ticked again, unticked again while the first save ran: back to the sent state, nothing more to send.
    expect(sent).toEqual([false]);
    expect(settled).toEqual([{ ok: true, value: "saved-false" }]);
  });

  it("sends the last state again when it changed meanwhile", async () => {
    const sent: boolean[] = [];
    const gate = deferred();
    const queue = createTickQueue<string>(
      async (_id, wanted) => {
        sent.push(wanted);
        if (sent.length === 1) await gate.promise;
        return { ok: true, value: "x" };
      },
      () => {},
    );
    queue.set("a", false, true);
    queue.set("a", true, false);
    gate.resolve();
    await queue.idle();
    expect(sent).toEqual([false, true]);
  });

  it("idle waits for the saves; a failure gives back the last confirmed state", async () => {
    const gate = deferred();
    const settled: unknown[] = [];
    let calls = 0;
    const queue = createTickQueue<string>(
      async () => {
        calls += 1;
        await gate.promise;
        return calls === 1 ? { ok: true, value: "x" } : { ok: false };
      },
      (_id, outcome) => settled.push(outcome),
    );
    queue.set("a", false, true);
    queue.set("a", true, false);
    let done = false;
    const waiting = queue.idle().then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    gate.resolve();
    await waiting;
    expect(settled).toEqual([{ ok: false, confirmed: false }]);
  });

  it("says when it starts and stops saving, once for several wishes, so a live refresh can wait", async () => {
    const gate = deferred();
    const busy: boolean[] = [];
    const queue = createTickQueue<string>(
      async () => {
        await gate.promise;
        return { ok: true, value: "x" };
      },
      () => {},
      (value) => busy.push(value),
    );
    expect(queue.busy()).toBe(false);
    queue.set("a", true, false);
    queue.set("b", true, false);
    expect(queue.busy()).toBe(true);
    expect(busy).toEqual([true]);
    gate.resolve();
    await queue.idle();
    expect(queue.busy()).toBe(false);
    expect(busy).toEqual([true, false]);
  });
});
