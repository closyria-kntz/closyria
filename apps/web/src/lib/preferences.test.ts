import { describe, expect, it } from "vitest";
import { discoveryShown, type PreferencesState, tipShown, withSeenTip } from "./preferences";

const ready = (seenTips: string[], onboardedAt: string | null = null): PreferencesState => ({
  status: "ready",
  view: { seenTips, onboardedAt },
});
const account = (email: string | null) => ({ email, firstName: null, createdAt: "2026-11-12T08:00:00.000Z" });

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
  it("only for a signed-in account that has not seen it", () => {
    expect(discoveryShown(account("lea@example.com"), ready([]))).toBe(true);
    expect(discoveryShown(account("lea@example.com"), ready([], "2026-11-12T08:00:00.000Z"))).toBe(false);
    expect(discoveryShown(account(null), ready([]))).toBe(false);
    expect(discoveryShown(null, ready([]))).toBe(false);
    expect(discoveryShown(account("lea@example.com"), { status: "loading" })).toBe(false);
    expect(discoveryShown(account("lea@example.com"), { status: "ready", view: null })).toBe(false);
  });
});

describe("withSeenTip", () => {
  it("adds a tip once, even without a session yet", () => {
    expect(withSeenTip(null, "home-levels")).toEqual({ seenTips: ["home-levels"], onboardedAt: null });
    const view = { seenTips: ["home-levels"], onboardedAt: null };
    expect(withSeenTip(view, "home-levels")).toBe(view);
  });
});
