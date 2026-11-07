import { expect, it } from "vitest";
import { createReturnGate, RETURN_REFRESH_GAP_MS } from "./refresh-on-return";

const visible = { visible: true, dialogOpen: false };

it("lets a return through once the gap has passed, never twice for the focus and visibility pair", () => {
  const gate = createReturnGate(0);
  expect(gate({ ...visible, now: RETURN_REFRESH_GAP_MS - 1 })).toBe(false);
  expect(gate({ ...visible, now: RETURN_REFRESH_GAP_MS })).toBe(true);
  expect(gate({ ...visible, now: RETURN_REFRESH_GAP_MS + 10 })).toBe(false);
  expect(gate({ ...visible, now: 2 * RETURN_REFRESH_GAP_MS + 10 })).toBe(true);
});

it("waits while the page is hidden or a window is open", () => {
  const gate = createReturnGate(0);
  const later = 10 * RETURN_REFRESH_GAP_MS;
  expect(gate({ visible: false, dialogOpen: false, now: later })).toBe(false);
  expect(gate({ visible: true, dialogOpen: true, now: later })).toBe(false);
  expect(gate({ ...visible, now: later })).toBe(true);
});
