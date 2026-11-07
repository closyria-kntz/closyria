import { describe, expect, it } from "vitest";
import { relativeDate } from "./relative-date";

const now = new Date(2026, 10, 8, 15, 0);
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const say = (iso: string) => relativeDate(iso, now, "fr").replace(/\s/g, " ");

describe("relativeDate", () => {
  it("counts minutes and hours on the same day", () => {
    expect(say(ago(10_000))).toBe("maintenant");
    expect(say(ago(5 * 60_000))).toBe("il y a 5 min");
    expect(say(ago(2 * 3_600_000))).toBe("il y a 2 h");
  });

  it("says « hier », then days, then the date after a week", () => {
    expect(say(new Date(2026, 10, 7, 23, 0).toISOString())).toBe("hier");
    expect(say(new Date(2026, 10, 5, 12, 0).toISOString())).toBe("il y a 3 jours");
    expect(say(new Date(2026, 9, 30, 12, 0).toISOString())).toBe("30 octobre");
    expect(say(new Date(2025, 9, 30, 12, 0).toISOString())).toBe("30 octobre 2025");
  });
});
