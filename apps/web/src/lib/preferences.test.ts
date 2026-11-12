import { describe, expect, it } from "vitest";
import { discoveryShown, mergeRead, type PreferencesState, tipShown, withSeenTip } from "./preferences";

const ready = (seenTips: string[], onboardedAt: string | null = null): PreferencesState => ({
  status: "ready",
  view: { seenTips, onboardedAt },
});

describe("tipShown", () => {
  it("waits for her preferences, then hides the closed tips only", () => {
    expect(tipShown({ status: "loading" }, "home-levels")).toBe(false);
    expect(tipShown(ready([]), "home-levels")).toBe(true);
    expect(tipShown(ready(["home-levels"]), "home-levels")).toBe(false);
    expect(tipShown(ready(["other"]), "home-levels")).toBe(true);
    expect(tipShown({ status: "ready", view: null }, "home-levels")).toBe(true);
  });
});

describe("discoveryShown", () => {
  it("for any account that has not seen it, guests and visitors without a session included", () => {
    expect(discoveryShown(ready([]))).toBe(true);
    expect(discoveryShown({ status: "ready", view: null })).toBe(true);
    expect(discoveryShown(ready([], "2026-11-12T08:00:00.000Z"))).toBe(false);
    expect(discoveryShown({ status: "loading" })).toBe(false);
  });
});

describe("mergeRead", () => {
  it("keeps what she did on the page over an older read", () => {
    const done = ready(["home-levels"], "2026-11-12T08:00:00.000Z");
    expect(mergeRead(done, { seenTips: [], onboardedAt: null })).toEqual({
      seenTips: ["home-levels"],
      onboardedAt: "2026-11-12T08:00:00.000Z",
    });
    expect(mergeRead(done, null)).toEqual({ seenTips: ["home-levels"], onboardedAt: "2026-11-12T08:00:00.000Z" });
    expect(mergeRead({ status: "loading" }, { seenTips: ["a"], onboardedAt: null })).toEqual({
      seenTips: ["a"],
      onboardedAt: null,
    });
  });
});

describe("withSeenTip", () => {
  it("adds a tip once, even without a session yet", () => {
    expect(withSeenTip(null, "home-levels")).toEqual({ seenTips: ["home-levels"], onboardedAt: null });
    const view = { seenTips: ["home-levels"], onboardedAt: null };
    expect(withSeenTip(view, "home-levels")).toBe(view);
  });
});
