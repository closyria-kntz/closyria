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

  it("forgets domains whose slot is more than a minute old", async () => {
    const delays: number[] = [];
    let now = 1_000_000;
    const throttle = createThrottle(
      2000,
      () => now,
      async (ms) => void delays.push(ms),
    );
    await throttle.wait("a.fr");
    now += 61_000;
    await throttle.wait("b.fr");
    await throttle.wait("a.fr");
    expect(delays).toEqual([]);
  });

  it("caps the domains kept at 10 000, evicting the oldest", async () => {
    const delays: number[] = [];
    const throttle = createThrottle(
      2000,
      () => 1_000_000,
      async (ms) => void delays.push(ms),
    );
    for (let i = 0; i <= 10_000; i++) await throttle.wait(`d${i}.fr`);
    await throttle.wait("d0.fr");
    expect(delays).toEqual([]);
    await throttle.wait("d10000.fr");
    expect(delays).toEqual([2000]);
  });
});

describe("createThrottle — Shopify-hosted shops (one request every 2 s overall)", () => {
  it("spaces requests to different Shopify shops by 2 000 ms, and leaves other shops alone", async () => {
    const c = clock();
    const throttle = createThrottle(2000, c.now, c.sleep, 2000);
    const at: [string, number][] = [];
    const go = async (domain: string, shopify: boolean) => {
      await throttle.wait(domain, shopify ? { shopify: "low" } : undefined);
      at.push([domain, c.state.now - 1_000_000]);
    };
    await go("a.fr", true);
    await go("b.fr", true);
    await go("other.fr", false);
    await go("c.fr", true);
    expect(at).toEqual([
      ["a.fr", 0],
      ["b.fr", 2000],
      ["other.fr", 2000],
      ["c.fr", 4000],
    ]);
  });

  it("serves concurrent waiters one slot each, 2 s apart, whatever their shop", async () => {
    const c = clock();
    const throttle = createThrottle(2000, c.now, c.sleep, 2000);
    await Promise.all(["a.fr", "b.fr", "c.fr", "d.fr"].map((domain) => throttle.wait(domain, { shopify: "low" })));
    // The first goes at once, each next one 2 s after the previous.
    expect(c.state.slept).toEqual([2000, 2000, 2000]);
    expect(c.state.now - 1_000_000).toBe(6000);
  });

  it("gives the next slot to a sheet's refresh (high) before the catalogue pages waiting (low)", async () => {
    const c = clock();
    const throttle = createThrottle(2000, c.now, c.sleep, 2000);
    const order: string[] = [];
    const go = (name: string, priority: "high" | "low") =>
      throttle.wait(`${name}.fr`, { shopify: priority }).then(() => void order.push(name));
    await go("first", "low");
    await Promise.all([go("page-1", "low"), go("page-2", "low"), go("refresh", "high")]);
    expect(order).toEqual(["first", "refresh", "page-1", "page-2"]);
  });

  it("does not wait when the last Shopify request is over 2 s old", async () => {
    const c = clock();
    const throttle = createThrottle(2000, c.now, c.sleep, 2000);
    await throttle.wait("a.fr", { shopify: "high" });
    c.state.now += 2500;
    await throttle.wait("b.fr", { shopify: "high" });
    expect(c.state.slept).toEqual([]);
  });
});
