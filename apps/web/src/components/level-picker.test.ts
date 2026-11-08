import { describe, expect, it } from "vitest";
import { PHOTO_CLICK_DELAY_MS, photoClickPlan, shouldSpark, stepFocus } from "./level-picker-logic";

const plain = { detail: 1, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

describe("photoClickPlan", () => {
  it("waits on a first click so a second one can win", () => {
    expect(photoClickPlan(plain)).toBe("wait");
  });
  it("opens the picker on the second click", () => {
    expect(photoClickPlan({ ...plain, detail: 2 })).toBe("pick");
  });
  it("ignores further clicks of the same burst", () => {
    expect(photoClickPlan({ ...plain, detail: 3 })).toBe("ignore");
  });
  it("lets the keyboard (detail 0) and new-tab clicks go through at once", () => {
    expect(photoClickPlan({ ...plain, detail: 0 })).toBe("pass");
    expect(photoClickPlan({ ...plain, metaKey: true })).toBe("pass");
    expect(photoClickPlan({ ...plain, ctrlKey: true })).toBe("pass");
    expect(photoClickPlan({ ...plain, shiftKey: true })).toBe("pass");
    expect(photoClickPlan({ ...plain, altKey: true })).toBe("pass");
    expect(photoClickPlan({ ...plain, button: 1 })).toBe("pass");
  });
  it("waits 300 ms", () => {
    expect(PHOTO_CLICK_DELAY_MS).toBe(300);
  });
});

describe("shouldSpark", () => {
  it("only for the highest level", () => {
    expect([1, 2, 3, 4].map(shouldSpark)).toEqual([false, false, false, true]);
  });
});

describe("stepFocus", () => {
  it("moves with the arrows and wraps", () => {
    expect(stepFocus(0, "ArrowRight", 4)).toBe(1);
    expect(stepFocus(3, "ArrowRight", 4)).toBe(0);
    expect(stepFocus(0, "ArrowLeft", 4)).toBe(3);
    expect(stepFocus(2, "ArrowDown", 4)).toBe(3);
    expect(stepFocus(2, "ArrowUp", 4)).toBe(1);
    expect(stepFocus(2, "Home", 4)).toBe(0);
    expect(stepFocus(1, "End", 4)).toBe(3);
    expect(stepFocus(1, "a", 4)).toBeNull();
  });
});
