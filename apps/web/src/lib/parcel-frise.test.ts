import { describe, expect, it } from "vitest";
import { friseOf } from "./parcel-frise";

describe("friseOf (the four steps of a parcel)", () => {
  it("fills the steps up to the current one", () => {
    expect(friseOf({ status: "in_transit", events: [{ status: "in_transit" }] })).toEqual({
      steps: [
        { key: "shipped", state: "passed" },
        { key: "on_the_way", state: "current" },
        { key: "out_for_delivery", state: "upcoming" },
        { key: "delivered", state: "upcoming" },
      ],
      exception: false,
    });
  });

  it("says « En point relais » on the third step for a parcel waiting there", () => {
    expect(friseOf({ status: "pickup_ready", events: [] })?.steps[2]).toEqual({ key: "pickup", state: "current" });
  });

  it("fills them all once delivered, the last one current", () => {
    expect(friseOf({ status: "delivered", events: [] })?.steps.map((s) => s.state)).toEqual([
      "passed",
      "passed",
      "passed",
      "current",
    ]);
  });

  it("keeps an incident on the last step reached, with the warning", () => {
    const frise = friseOf({ status: "exception", events: [{ status: "exception" }, { status: "in_transit" }] });
    expect(frise?.steps.map((s) => s.state)).toEqual(["passed", "current", "upcoming", "upcoming"]);
    expect(frise?.exception).toBe(true);
  });

  it("draws nothing while nothing is known", () => {
    expect(friseOf({ status: "pending", events: [] })).toBeNull();
    expect(friseOf({ status: "unknown", events: [{ status: "in_transit" }] })).toBeNull();
  });
});
