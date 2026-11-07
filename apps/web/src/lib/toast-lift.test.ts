import { expect, it } from "vitest";
import { toastBottomFor } from "./toast-lift";

it("puts the toast 8 px above the bar's top", () => {
  expect(toastBottomFor(700, 800)).toBe(108);
});

it("leaves the toast in its usual place when there is no bar or it is below the window", () => {
  expect(toastBottomFor(null, 800)).toBeNull();
  expect(toastBottomFor(820, 800)).toBeNull();
});
