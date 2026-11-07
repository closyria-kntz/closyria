import { describe, expect, it } from "vitest";
import { FAR_FUTURE, type PeriodBudget, periodAt, previousPeriods } from "./budgets";

const created = new Date("2026-01-05T10:00:00Z");
const budget = (overrides: Partial<PeriodBudget>): PeriodBudget => ({
  period: "week",
  startsOn: null,
  endsOn: null,
  resetAt: null,
  createdAt: created,
  ...overrides,
});
const iso = (p: { start: Date; end: Date } | null) => p && { start: p.start.toISOString(), end: p.end.toISOString() };

describe("periodAt (Europe/Paris)", () => {
  it("week: Sunday 23:30 in Paris is still in the week begun on Monday", () => {
    expect(iso(periodAt(budget({}), new Date("2026-11-08T22:30:00Z")))).toEqual({
      start: "2026-11-01T23:00:00.000Z",
      end: "2026-11-08T23:00:00.000Z",
    });
  });

  it("week: 00:30 on Monday in Paris starts the next week", () => {
    expect(iso(periodAt(budget({}), new Date("2026-11-08T23:30:00Z")))).toEqual({
      start: "2026-11-08T23:00:00.000Z",
      end: "2026-11-15T23:00:00.000Z",
    });
  });

  it("week across the end of daylight time (2026-10-25)", () => {
    expect(iso(periodAt(budget({}), new Date("2026-10-25T12:00:00Z")))).toEqual({
      start: "2026-10-18T22:00:00.000Z",
      end: "2026-10-25T23:00:00.000Z",
    });
  });

  it("month across the end of daylight time: 1 October 00:00 summer time to 1 November 00:00 winter time", () => {
    expect(iso(periodAt(budget({ period: "month" }), new Date("2026-10-26T10:00:00Z")))).toEqual({
      start: "2026-09-30T22:00:00.000Z",
      end: "2026-10-31T23:00:00.000Z",
    });
    // 00:30 on 1 November in Paris is already November.
    expect(iso(periodAt(budget({ period: "month" }), new Date("2026-10-31T23:30:00Z")))).toEqual({
      start: "2026-10-31T23:00:00.000Z",
      end: "2026-11-30T23:00:00.000Z",
    });
  });

  it("month: December runs into January of the next year", () => {
    expect(iso(periodAt(budget({ period: "month" }), new Date("2026-12-20T10:00:00Z")))).toEqual({
      start: "2026-11-30T23:00:00.000Z",
      end: "2026-12-31T23:00:00.000Z",
    });
  });

  it("custom: includes its last day until 23:59:59 in Paris, then has ended", () => {
    const custom = budget({ period: "custom", startsOn: "2026-12-01", endsOn: "2026-12-15" });
    const period = { start: "2026-11-30T23:00:00.000Z", end: "2026-12-15T23:00:00.000Z" };
    expect(iso(periodAt(custom, new Date("2026-12-15T22:59:59Z")))).toEqual(period);
    expect(iso(periodAt(custom, new Date("2026-11-20T10:00:00Z")))).toEqual(period);
    expect(periodAt(custom, new Date("2026-12-15T23:00:00Z"))).toBeNull();
  });

  it("none: from the last reset, else from the creation, without end", () => {
    const none = budget({ period: "none" });
    expect(periodAt(none, new Date("2026-11-08T10:00:00Z"))).toEqual({ start: created, end: FAR_FUTURE });
    const resetAt = new Date("2026-11-01T08:00:00Z");
    expect(periodAt({ ...none, resetAt }, new Date("2026-11-08T10:00:00Z"))).toEqual({
      start: resetAt,
      end: FAR_FUTURE,
    });
    expect(FAR_FUTURE.toISOString()).toBe("9999-12-31T00:00:00.000Z");
  });
});

describe("previousPeriods", () => {
  const now = new Date("2026-11-08T10:00:00Z"); // Sunday; week begun Monday 2 November

  it("week: the 8 last complete weeks, newest first", () => {
    const weeks = previousPeriods(budget({}), now).map(iso);
    expect(weeks).toHaveLength(8);
    expect(weeks[0]).toEqual({ start: "2026-10-25T23:00:00.000Z", end: "2026-11-01T23:00:00.000Z" });
    expect(weeks[1]).toEqual({ start: "2026-10-18T22:00:00.000Z", end: "2026-10-25T23:00:00.000Z" });
    expect(weeks[7]?.start).toBe("2026-09-06T22:00:00.000Z");
  });

  it("week: never before the week of the creation", () => {
    // Created on Wednesday 21 October: its week (from 19 October) and the next one.
    const weeks = previousPeriods(budget({ createdAt: new Date("2026-10-21T10:00:00Z") }), now).map(iso);
    expect(weeks.map((w) => w?.start)).toEqual(["2026-10-25T23:00:00.000Z", "2026-10-18T22:00:00.000Z"]);
    expect(previousPeriods(budget({ createdAt: new Date("2026-11-03T10:00:00Z") }), now)).toEqual([]);
  });

  it("month: the 12 last months, never before the month of the creation", () => {
    const months = previousPeriods(budget({ period: "month" }), now).map(iso);
    expect(months).toHaveLength(10); // created in January: January to October
    expect(months[0]).toEqual({ start: "2026-09-30T22:00:00.000Z", end: "2026-10-31T23:00:00.000Z" });
    expect(months[9]?.start).toBe("2025-12-31T23:00:00.000Z");
    const old = budget({ period: "month", createdAt: new Date("2020-01-01T00:00:00Z") });
    expect(previousPeriods(old, now)).toHaveLength(12);
  });

  it("custom and none: no history", () => {
    expect(previousPeriods(budget({ period: "none" }), now)).toEqual([]);
    expect(previousPeriods(budget({ period: "custom", startsOn: "2026-10-01", endsOn: "2026-10-15" }), now)).toEqual(
      [],
    );
  });
});
