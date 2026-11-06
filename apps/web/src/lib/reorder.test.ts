import { describe, expect, it } from "vitest";
import { moveId } from "./reorder";

describe("moveId", () => {
  const ids = ["a", "b", "c"];

  it("moves one place up or down", () => {
    expect(moveId(ids, "b", "up")).toEqual(["b", "a", "c"]);
    expect(moveId(ids, "b", "down")).toEqual(["a", "c", "b"]);
  });

  it("returns null at the ends and for an unknown id", () => {
    expect(moveId(ids, "a", "up")).toBeNull();
    expect(moveId(ids, "c", "down")).toBeNull();
    expect(moveId(ids, "z", "up")).toBeNull();
  });

  it("does not change its input", () => {
    moveId(ids, "b", "up");
    expect(ids).toEqual(["a", "b", "c"]);
  });
});
