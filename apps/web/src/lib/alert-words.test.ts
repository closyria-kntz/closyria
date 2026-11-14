import { describe, expect, it } from "vitest";
import { daysUntil, saleDayWords } from "./alert-words";

// Wednesday 14 January 2026, 23:30 in Paris (22:30 UTC): still the 14th there.
const now = new Date("2026-01-14T22:30:00Z");

describe("daysUntil", () => {
  it("counts Paris calendar days", () => {
    expect(daysUntil("2026-01-14", now)).toBe(0);
    expect(daysUntil("2026-01-15", now)).toBe(1);
    expect(daysUntil("2026-01-13", now)).toBe(-1);
    // 23:30 UTC is already the 15th in Paris.
    expect(daysUntil("2026-01-15", new Date("2026-01-14T23:30:00Z"))).toBe(0);
  });
});

describe("saleDayWords", () => {
  it("says aujourd'hui, demain, hier", () => {
    expect(saleDayWords("2026-01-14", now, "fr")).toEqual({ started: false, kind: "relative", text: "aujourd’hui" });
    expect(saleDayWords("2026-01-15", now, "fr")).toEqual({ started: false, kind: "relative", text: "demain" });
    expect(saleDayWords("2026-01-13", now, "fr")).toEqual({ started: true, kind: "relative", text: "hier" });
  });

  it("says the weekday within the week, then the date", () => {
    expect(saleDayWords("2026-01-16", now, "fr")).toEqual({ started: false, kind: "weekday", text: "vendredi" });
    expect(saleDayWords("2026-01-20", now, "fr")).toEqual({ started: false, kind: "weekday", text: "mardi" });
    expect(saleDayWords("2026-01-21", now, "fr")).toEqual({ started: false, kind: "date", text: "21 janvier" });
    expect(saleDayWords("2026-01-07", now, "fr")).toEqual({ started: true, kind: "date", text: "7 janvier" });
  });
});
