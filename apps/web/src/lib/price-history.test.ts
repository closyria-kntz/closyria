import { describe, expect, it } from "vitest";
import { curveGeometry, dropMention } from "./price-history";

const NOW = new Date("2026-11-08T15:00:00.000Z"); // a Sunday

describe("dropMention", () => {
  const base = { points: [], lowestSinceDays: null, dropCents: null, dropSince: null };

  it("says nothing without a drop", () => {
    expect(dropMention(base, NOW)).toBeNull();
    expect(dropMention({ ...base, lowestSinceDays: 80 }, NOW)).toBeNull();
  });

  it("gives the drop, the day and the months, rounded down, from 30 days", () => {
    expect(dropMention({ ...base, dropCents: -2000, dropSince: "2026-11-03", lowestSinceDays: 95 }, NOW)).toEqual({
      cents: 2000,
      since: { kind: "weekday", date: new Date("2026-11-03T00:00:00.000Z") },
      months: 3,
    });
    expect(dropMention({ ...base, dropCents: -300, dropSince: "2026-11-08", lowestSinceDays: 59 }, NOW)?.months).toBe(
      1,
    );
  });

  it("never claims a low under 30 days", () => {
    expect(dropMention({ ...base, dropCents: -300, dropSince: "2026-11-08", lowestSinceDays: 29 }, NOW)?.months).toBe(
      null,
    );
    expect(dropMention({ ...base, dropCents: -300, dropSince: "2026-11-08", lowestSinceDays: null }, NOW)?.months).toBe(
      null,
    );
  });

  it("names the day: today, yesterday, a weekday within the week, else the date", () => {
    const since = (day: string) => dropMention({ ...base, dropCents: -100, dropSince: day }, NOW)?.since.kind;
    expect(since("2026-11-08")).toBe("today");
    expect(since("2026-11-07")).toBe("yesterday");
    expect(since("2026-11-02")).toBe("weekday");
    expect(since("2026-11-01")).toBe("date");
  });
});

describe("curveGeometry", () => {
  it("needs two points", () => {
    expect(curveGeometry([], 170, 60)).toBeNull();
    expect(curveGeometry([{ at: "2026-11-01T00:00:00.000Z", priceCents: 100 }], 170, 60)).toBeNull();
  });

  it("spreads the points on time, the lowest price at the bottom, and ends on the last one", () => {
    const geometry = curveGeometry(
      [
        { at: "2026-08-10T00:00:00.000Z", priceCents: 2500 },
        { at: "2026-09-29T00:00:00.000Z", priceCents: 2600 },
        { at: "2026-11-08T00:00:00.000Z", priceCents: 2300 },
      ],
      170,
      60,
    );
    if (!geometry) throw new Error("no geometry");
    const pairs = geometry.points.split(" ").map((pair) => pair.split(",").map(Number));
    expect(pairs).toHaveLength(3);
    const [first, second, last] = pairs as [number[], number[], number[]];
    expect(first[0]).toBeLessThan(second[0] as number);
    expect(second[0]).toBeLessThan(last[0] as number);
    // SVG y grows downwards: the highest price is the smallest y, the lowest the largest.
    expect(second[1]).toBeLessThan(first[1] as number);
    expect(last[1]).toBeGreaterThan(first[1] as number);
    expect(geometry.end).toEqual({ x: last[0], y: last[1] });
    for (const [x, y] of pairs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(170);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(60);
    }
  });

  it("draws a flat price in the middle", () => {
    const geometry = curveGeometry(
      [
        { at: "2026-10-01T00:00:00.000Z", priceCents: 2300 },
        { at: "2026-11-01T00:00:00.000Z", priceCents: 2300 },
      ],
      170,
      60,
    );
    expect(geometry?.points.split(" ").map((pair) => Number(pair.split(",")[1]))).toEqual([30, 30]);
  });
});
