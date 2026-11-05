import { describe, expect, it } from "vitest";
import { shopHealth } from "./health";

const live = { status: "published", captureMode: "auto" } as const;

describe("shopHealth", () => {
  it("is down when the two latest monitor captures failed", () => {
    expect(shopHealth({ ...live, lastMonitors: [false, false], successRate7d: 0.9 })).toBe("down");
  });
  it("is degraded under an 80% success rate", () => {
    expect(shopHealth({ ...live, lastMonitors: [true], successRate7d: 0.7 })).toBe("degraded");
  });
  it("is ok otherwise, including without data", () => {
    expect(shopHealth({ ...live, lastMonitors: [true, false], successRate7d: 0.8 })).toBe("ok");
    expect(shopHealth({ ...live, lastMonitors: [], successRate7d: null })).toBe("ok");
    expect(shopHealth({ ...live, lastMonitors: [false], successRate7d: null })).toBe("ok");
  });
  it("is not applicable to a draft, a pending shop or a manual one", () => {
    const base = { lastMonitors: [false, false], successRate7d: 0 };
    expect(shopHealth({ ...base, status: "draft", captureMode: "auto" })).toBe("not_applicable");
    expect(shopHealth({ ...base, status: "pending", captureMode: "auto" })).toBe("not_applicable");
    expect(shopHealth({ ...base, status: "published", captureMode: "manual" })).toBe("not_applicable");
  });
});
