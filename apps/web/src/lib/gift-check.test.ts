import { afterEach, describe, expect, it, vi } from "vitest";
import {
  answerGiftWarning,
  canReceiveAsGift,
  confirmUnlessReserved,
  createTakeGuard,
  getGiftWarning,
  isPurchaseMove,
  subscribeGiftWarning,
} from "./gift-check";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";

let unsubscribe: (() => void) | null = null;
/** A window is mounted (the app shell's host). */
const mount = () => {
  unsubscribe = subscribeGiftWarning(() => {});
};
afterEach(() => {
  const open = getGiftWarning();
  if (open) answerGiftWarning(open.id, false);
  unsubscribe?.();
  unsubscribe = null;
});

/** Lets the pending check resolve, then the window shows. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("confirmUnlessReserved", () => {
  it("goes on without a window when nothing is reserved", async () => {
    mount();
    const took = vi.fn(async () => undefined);
    await expect(confirmUnlessReserved([A, B], "order", { check: async () => [], took })).resolves.toBe(true);
    expect(getGiftWarning()).toBeNull();
    expect(took).not.toHaveBeenCalled();
  });

  it("goes on without a window when the check fails (never blocks a purchase)", async () => {
    mount();
    const check = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(confirmUnlessReserved([A], "take", { check, took: vi.fn() })).resolves.toBe(true);
    expect(getGiftWarning()).toBeNull();
  });

  it("asks, and « Attendre » does nothing", async () => {
    mount();
    const took = vi.fn(async () => undefined);
    const answer = confirmUnlessReserved([A, B, C], "order", { check: async () => [A, B], took });
    await settle();
    const open = getGiftWarning();
    expect(open).toMatchObject({ count: 2, kind: "order" });
    answerGiftWarning(open?.id ?? 0, false);
    await expect(answer).resolves.toBe(false);
    expect(took).not.toHaveBeenCalled();
    expect(getGiftWarning()).toBeNull();
  });

  it("« quand même » marks the reserved ones taken by herself, then goes on", async () => {
    mount();
    const took = vi.fn(async () => undefined);
    const answer = confirmUnlessReserved([A, A, B], "take", {
      check: async (ids) => ids.filter((id) => id === A),
      took,
    });
    await settle();
    const open = getGiftWarning();
    expect(open).toMatchObject({ count: 1, kind: "take" });
    answerGiftWarning(open?.id ?? 0, true);
    await expect(answer).resolves.toBe(true);
    expect(took).toHaveBeenCalledWith([A]);
  });

  it("goes on even when marking fails", async () => {
    mount();
    const took = vi.fn(async () => {
      throw new Error("offline");
    });
    const answer = confirmUnlessReserved([A], "stage", { check: async () => [A], took });
    await settle();
    answerGiftWarning(getGiftWarning()?.id ?? 0, true);
    await expect(answer).resolves.toBe(true);
  });

  it("checks no more than 200 at a time", async () => {
    mount();
    const ids = Array.from({ length: 450 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const check = vi.fn(async (_ids: readonly string[]) => [] as string[]);
    await confirmUnlessReserved(ids, "order", { check, took: vi.fn() });
    expect(check.mock.calls.map(([batch]) => batch.length)).toEqual([200, 200, 50]);
  });

  it("a second request closes the first as « Attendre »", async () => {
    mount();
    const deps = { check: async () => [A], took: vi.fn(async () => undefined) };
    const first = confirmUnlessReserved([A], "take", deps);
    await settle();
    const second = confirmUnlessReserved([A], "stage", deps);
    await settle();
    await expect(first).resolves.toBe(false);
    expect(getGiftWarning()).toMatchObject({ kind: "stage" });
    answerGiftWarning(getGiftWarning()?.id ?? 0, true);
    await expect(second).resolves.toBe(true);
  });
});

describe("isPurchaseMove", () => {
  it("asks only when a wish or an order becomes « Commandé » or « Reçu »", () => {
    expect(isPurchaseMove("spotted", "ordered")).toBe(true);
    expect(isPurchaseMove("spotted", "owned")).toBe(true);
    expect(isPurchaseMove("ordered", "owned")).toBe(true);
    expect(isPurchaseMove("ordered", "ordered")).toBe(false);
    expect(isPurchaseMove("returned", "owned")).toBe(false);
    expect(isPurchaseMove("for_sale", "owned")).toBe(false);
    expect(isPurchaseMove("spotted", "returned")).toBe(false);
  });
});

describe("canReceiveAsGift", () => {
  const item = { stage: "spotted" as const, receivedAsGift: false, deletedAt: null };
  it("is offered until it is a gift, never in the trash or once sold", () => {
    expect(canReceiveAsGift(item)).toBe(true);
    expect(canReceiveAsGift({ ...item, stage: "owned" })).toBe(true);
    expect(canReceiveAsGift({ ...item, stage: "owned", receivedAsGift: true })).toBe(false);
    expect(canReceiveAsGift({ ...item, stage: "sold" })).toBe(false);
    expect(canReceiveAsGift({ ...item, deletedAt: "2026-11-09T10:00:00.000Z" })).toBe(false);
  });
});

describe("createTakeGuard", () => {
  it("lets a tap through once checked", async () => {
    const guard = createTakeGuard(async () => true);
    await expect(guard.check(A)).resolves.toBe("go");
    expect(guard.cancel(A)).toBe(false);
  });

  it("a second tap during the check takes the first back", async () => {
    let release: (go: boolean) => void = () => {};
    const guard = createTakeGuard(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const first = guard.check(A);
    expect(guard.cancel(A)).toBe(true);
    release(true);
    await expect(first).resolves.toBe("cancelled");
  });

  it("says « wait » when she waits", async () => {
    await expect(createTakeGuard(async () => false).check(A)).resolves.toBe("wait");
  });
});
