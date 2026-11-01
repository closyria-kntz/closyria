import { expect, it } from "vitest";
import { createOncePerPath } from "./once-per-path";

it("lets a path through once, again after navigating elsewhere", () => {
  const first = createOncePerPath();
  expect(first("/a")).toBe(true);
  expect(first("/a")).toBe(false); // strict-mode double effect
  expect(first("/b")).toBe(true);
  expect(first("/a")).toBe(true);
});
