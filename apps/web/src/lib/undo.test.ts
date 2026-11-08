import { UNDO_DELAY_MS } from "@closyria/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearUndo, getUndo, getUndoStack, pushUndo, runUndo, subscribeUndo } from "./undo";

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

  it("stacks messages instead of replacing them, newest last", () => {
    pushUndo("A", null);
    pushUndo("B", null);
    pushUndo("C", null);
    expect(getUndoStack().map((e) => e.label)).toEqual(["A", "B", "C"]);
    expect(getUndo()?.label).toBe("C");
  });

  it("drops the oldest when a fourth arrives", () => {
    for (const l of ["A", "B", "C", "D"]) pushUndo(l, null);
    expect(getUndoStack().map((e) => e.label)).toEqual(["B", "C", "D"]);
  });

  it("returns a stable snapshot until the stack changes", () => {
    pushUndo("A", null);
    const first = getUndoStack();
    expect(getUndoStack()).toBe(first);
    pushUndo("B", null);
    expect(getUndoStack()).not.toBe(first);
  });

  it("runs the entry with the given id and keeps the others", async () => {
    const a = vi.fn(async () => true);
    const b = vi.fn(async () => true);
    pushUndo("A", a);
    pushUndo("B", b);
    const [first] = getUndoStack();
    expect(await runUndo(first?.id)).toBe(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(getUndoStack().map((e) => e.label)).toEqual(["B"]);
  });

  it("runs the newest entry when no id is given", async () => {
    const a = vi.fn(async () => true);
    const b = vi.fn(async () => true);
    pushUndo("A", a);
    pushUndo("B", b);
    await runUndo();
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });

  it("expires each entry on its own delay", () => {
    pushUndo("A", null);
    vi.advanceTimersByTime(5000);
    pushUndo("B", null);
    vi.advanceTimersByTime(UNDO_DELAY_MS - 5000);
    expect(getUndoStack().map((e) => e.label)).toEqual(["B"]);
    vi.advanceTimersByTime(5000);
    expect(getUndoStack()).toEqual([]);
  });

  it("does not let an evicted entry's timer remove a later one", () => {
    for (const l of ["A", "B", "C", "D"]) pushUndo(l, null);
    vi.advanceTimersByTime(UNDO_DELAY_MS);
    expect(getUndoStack()).toEqual([]);
  });

  it("clearUndo empties the whole stack", () => {
    pushUndo("A", null);
    pushUndo("B", null);
    clearUndo();
    expect(getUndoStack()).toEqual([]);
    expect(getUndo()).toBeNull();
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
