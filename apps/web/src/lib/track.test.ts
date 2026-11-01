import { describe, expect, it, vi } from "vitest";
import { createTracker, type TrackerEnv } from "./track";

function setup(over: Partial<TrackerEnv> = {}) {
  let hidden: (() => void) | undefined;
  let timer: (() => void) | undefined;
  const sent: unknown[] = [];
  const env: TrackerEnv = {
    endpoint: "/api/events",
    path: () => "/items/42",
    now: () => new Date("2026-11-01T10:00:00.000Z"),
    optedOut: () => false,
    beacon: (_url, body) => {
      sent.push(JSON.parse(body));
      return true;
    },
    post: vi.fn(async () => {}),
    setTimer: (fn) => {
      timer = fn;
      return 1;
    },
    clearTimer: () => {
      timer = undefined;
    },
    onHidden: (fn) => {
      hidden = fn;
    },
    ...over,
  };
  return { env, sent, tracker: createTracker(env), fire: () => timer?.(), hide: () => hidden?.() };
}

describe("track", () => {
  it("batches events and flushes them in one beacon when the timer fires", () => {
    const { tracker, sent, fire } = setup();
    tracker.track("page_view");
    tracker.track("signup_started", { step: 1 });
    expect(sent).toEqual([]);
    fire();
    expect(sent).toEqual([
      {
        events: [
          { name: "page_view", path: "/items/42", occurredAt: "2026-11-01T10:00:00.000Z" },
          { name: "signup_started", path: "/items/42", occurredAt: "2026-11-01T10:00:00.000Z", props: { step: 1 } },
        ],
      },
    ]);
  });

  it("flushes at once at 20 events", () => {
    const { tracker, sent } = setup();
    for (let i = 0; i < 20; i++) tracker.track("page_view");
    expect(sent).toHaveLength(1);
    expect((sent[0] as { events: unknown[] }).events).toHaveLength(20);
    tracker.track("page_view");
    expect(sent).toHaveLength(1);
  });

  it("flushes when the page becomes hidden, and sends nothing when the queue is empty", () => {
    const { tracker, sent, hide } = setup();
    hide();
    expect(sent).toEqual([]);
    tracker.track("page_view");
    hide();
    expect(sent).toHaveLength(1);
  });

  it("falls back to fetch keepalive when sendBeacon is missing or refuses", () => {
    const post = vi.fn(async () => {});
    const { tracker, fire } = setup({ beacon: () => false, post });
    tracker.track("page_view");
    fire();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/api/events", expect.stringContaining('"page_view"'));
  });

  it("does not throw when the transport fails", () => {
    const { tracker, fire } = setup({
      beacon: () => false,
      post: async () => {
        throw new Error("offline");
      },
    });
    tracker.track("page_view");
    expect(() => fire()).not.toThrow();
  });

  it("sends nothing when Global Privacy Control or Do Not Track is on", () => {
    const { tracker, sent, fire, hide } = setup({ optedOut: () => true });
    tracker.track("page_view");
    fire();
    hide();
    expect(sent).toEqual([]);
  });
});
