import { describe, expect, it } from "vitest";
import { draftError, periodPhase } from "./rules";

describe("periodPhase", () => {
  const winter = { startsOn: "2027-01-06", endsOn: "2027-02-02" };
  it("is upcoming before the first day, current from the first to the last day, past after", () => {
    expect(periodPhase(winter, "2027-01-05")).toBe("upcoming");
    expect(periodPhase(winter, "2027-01-06")).toBe("current");
    expect(periodPhase(winter, "2027-02-02")).toBe("current");
    expect(periodPhase(winter, "2027-02-03")).toBe("past");
  });
});

describe("draftError", () => {
  it("asks for a name and both days, and an end on or after the start", () => {
    expect(draftError({ name: "  ", startsOn: "2027-01-06", endsOn: "2027-01-06" })).toBe("invalidName");
    expect(draftError({ name: "Soldes", startsOn: "", endsOn: "2027-01-06" })).toBe("invalidDates");
    expect(draftError({ name: "Soldes", startsOn: "2027-01-06", endsOn: "2027-01-05" })).toBe("endBeforeStart");
    expect(draftError({ name: "Soldes", startsOn: "2027-01-06", endsOn: "2027-01-06" })).toBeNull();
  });
});
