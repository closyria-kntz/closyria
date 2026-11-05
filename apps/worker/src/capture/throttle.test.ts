import { describe, expect, it } from "vitest";
import { createThrottle } from "./throttle";

function clock() {
  const state = { now: 1_000_000, slept: [] as number[] };
  return {
    state,
    now: () => state.now,
    sleep: async (ms: number) => {
      state.slept.push(ms);
      state.now += ms;
    },
  };
}

describe("createThrottle", () => {
  it("lets the first call through and spaces the next on the same domain by 2 000 ms", async () => {
    const c = clock();
    const throttle = createThrottle(2000, c.now, c.sleep);
    await throttle.wait("a.fr");
    expect(c.state.slept).toEqual([]);
    await throttle.wait("a.fr");
    expect(c.state.slept).toEqual([2000]);
  });

  it("does not sleep when enough time has passed", async () => {
    const c = clock();
    const throttle = createThrottle(2000, c.now, c.sleep);
    await throttle.wait("a.fr");
    c.state.now += 2500;
    await throttle.wait("a.fr");
    expect(c.state.slept).toEqual([]);
  });

  it("does not make other domains wait", async () => {
    const c = clock();
    const throttle = createThrottle(2000, c.now, c.sleep);
    await throttle.wait("a.fr");
    await throttle.wait("b.fr");
    expect(c.state.slept).toEqual([]);
  });

  it("serialises two concurrent waits on a.fr", async () => {
    const delays: number[] = [];
    const throttle = createThrottle(
      2000,
      () => 1_000_000,
      async (ms) => void delays.push(ms),
    );
    await Promise.all([throttle.wait("a.fr"), throttle.wait("a.fr")]);
    expect(delays).toEqual([2000]);
  });

  it("queues each concurrent wait one interval after the previous", async () => {
    const delays: number[] = [];
    const throttle = createThrottle(
      2000,
      () => 1_000_000,
      async (ms) => void delays.push(ms),
    );
    await Promise.all([throttle.wait("a.fr"), throttle.wait("a.fr"), throttle.wait("a.fr"), throttle.wait("b.fr")]);
    expect(delays).toEqual([2000, 4000]);
  });
});
