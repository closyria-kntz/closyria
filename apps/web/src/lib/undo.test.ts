import { UNDO_DELAY_MS } from "@closyria/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearUndo, getUndo, pushUndo, runUndo, subscribeUndo } from "./undo";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  clearUndo();
  vi.useRealTimers();
});

describe("undo", () => {
  it("keeps the last operation for 8 s, then drops it", () => {
    const op = vi.fn(async () => true);
    pushUndo("Ajouté", op);
    expect(getUndo()).toMatchObject({ label: "Ajouté", undoable: true });
    vi.advanceTimersByTime(UNDO_DELAY_MS - 1);
    expect(getUndo()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(getUndo()).toBeNull();
  });

  it("replaces the previous operation and restarts the delay", () => {
    pushUndo("A", async () => true);
    vi.advanceTimersByTime(5000);
    pushUndo("B", async () => true);
    vi.advanceTimersByTime(5000);
    expect(getUndo()?.label).toBe("B");
  });

  it("runs the operation once and clears it", async () => {
    const op = vi.fn(async () => true);
    pushUndo("A", op);
    expect(await runUndo()).toBe(true);
    expect(await runUndo()).toBe(false);
    expect(op).toHaveBeenCalledTimes(1);
    expect(getUndo()).toBeNull();
  });

  it("shows a message without Annuler when there is nothing to undo", async () => {
    pushUndo("Supprimé", null);
    expect(getUndo()).toMatchObject({ undoable: false });
    expect(await runUndo()).toBe(false);
  });

  it("notifies subscribers", () => {
    const listener = vi.fn();
    const stop = subscribeUndo(listener);
    pushUndo("A", null);
    stop();
    pushUndo("B", null);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
