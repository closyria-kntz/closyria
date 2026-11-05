import { describe, expect, it } from "vitest";
import { viewKey } from "./view-key";

describe("viewKey", () => {
  it("changes with the product and with the capture", () => {
    expect(viewKey("p", null)).not.toBe(viewKey("p", "c"));
    expect(viewKey("p", "c1")).not.toBe(viewKey("p", "c2"));
    expect(viewKey("p1", "c")).not.toBe(viewKey("p2", "c"));
    expect(viewKey("p", "c")).toBe(viewKey("p", "c"));
  });
});
