import { describe, expect, it } from "vitest";
import { deviceFromUserAgent, eventBatchSchema, eventNames, eventSchema, MAX_EVENTS_PER_BATCH } from "./events";

const base = { name: "page_view", path: "/", occurredAt: "2026-11-01T10:00:00.000Z" } as const;

describe("event names", () => {
  it("is the closed list of the brief", () => {
    expect(eventNames.slice(0, 3)).toEqual(["page_view", "signup_started", "signup_completed"]);
  });
  it("refuses an unknown name", () => {
    expect(eventSchema.safeParse({ ...base, name: "hack" }).success).toBe(false);
  });
});

describe("event path", () => {
  it("keeps only the path: no query string, no fragment", () => {
    const parsed = eventSchema.parse({ ...base, path: "/items/42?email=a@b.fr&token=x#section" });
    expect(parsed.path).toBe("/items/42");
    expect(eventSchema.parse({ ...base, path: "/a#frag?x=1" }).path).toBe("/a");
  });
  it("refuses a full URL or a relative path", () => {
    expect(eventSchema.safeParse({ ...base, path: "https://evil.example/x" }).success).toBe(false);
    expect(eventSchema.safeParse({ ...base, path: "items" }).success).toBe(false);
  });
  it("refuses a path over 200 characters", () => {
    expect(eventSchema.safeParse({ ...base, path: `/${"a".repeat(200)}` }).success).toBe(false);
  });
});

describe("event occurredAt", () => {
  it("requires an ISO datetime", () => {
    expect(eventSchema.safeParse({ ...base, occurredAt: "yesterday" }).success).toBe(false);
    expect(eventSchema.safeParse({ ...base, occurredAt: 1730000000 }).success).toBe(false);
  });
});

describe("event props", () => {
  it("accepts a small flat object of string, number and boolean", () => {
    expect(eventSchema.safeParse({ ...base, props: { a: "x", b: 1, c: true } }).success).toBe(true);
  });
  it("refuses nesting, more than 10 keys and values over 200 characters", () => {
    expect(eventSchema.safeParse({ ...base, props: { a: { b: 1 } } }).success).toBe(false);
    expect(eventSchema.safeParse({ ...base, props: { a: null } }).success).toBe(false);
    const eleven = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, i]));
    expect(eventSchema.safeParse({ ...base, props: eleven }).success).toBe(false);
    expect(eventSchema.safeParse({ ...base, props: { a: "x".repeat(201) } }).success).toBe(false);
    expect(eventSchema.safeParse({ ...base, props: { a: "x".repeat(200) } }).success).toBe(true);
  });
  it("refuses keys over 40 characters", () => {
    expect(eventSchema.safeParse({ ...base, props: { [`k${"x".repeat(40)}`]: 1 } }).success).toBe(false);
  });
});

describe("event batch", () => {
  it("accepts 20 events and refuses 21 or none", () => {
    const events = (n: number) => Array.from({ length: n }, () => base);
    expect(MAX_EVENTS_PER_BATCH).toBe(20);
    expect(eventBatchSchema.safeParse({ events: events(20) }).success).toBe(true);
    expect(eventBatchSchema.safeParse({ events: events(21) }).success).toBe(false);
    expect(eventBatchSchema.safeParse({ events: [] }).success).toBe(false);
  });
});

describe("deviceFromUserAgent", () => {
  const cases: [string, string | undefined, "mobile" | "desktop" | "tablet"][] = [
    ["iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", "mobile"],
    [
      "Android phone",
      "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36",
      "mobile",
    ],
    ["iPad", "Mozilla/5.0 (iPad; CPU OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", "tablet"],
    [
      "Android tablet",
      "Mozilla/5.0 (Linux; Android 16; SM-X900) AppleWebKit/537.36 Chrome/140 Safari/537.36",
      "tablet",
    ],
    ["desktop Chrome", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36", "desktop"],
    [
      "Mac Safari",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/19 Safari/605.1.15",
      "desktop",
    ],
    ["no user agent", undefined, "desktop"],
  ];
  it.each(cases)("%s", (_label, ua, expected) => {
    expect(deviceFromUserAgent(ua)).toBe(expected);
  });
});

describe("wardrobe event names", () => {
  it("includes the chantier 2a events", () => {
    for (const name of [
      "item_saved",
      "item_stage_changed",
      "item_moved",
      "wishlist_shared",
      "account_prompt_shown",
      "account_created_from_prompt",
    ]) {
      expect(eventSchema.safeParse({ ...base, name }).success, name).toBe(true);
    }
  });
});
