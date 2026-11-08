import { afterEach, describe, expect, it, vi } from "vitest";
import { flyTo } from "./fly-to";

type FakeEl = {
  className: string;
  style: { setProperty: ReturnType<typeof vi.fn> };
  animate: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
};

function setup({ reduced, animate }: { reduced: boolean; animate?: () => unknown }) {
  const el: FakeEl = {
    className: "",
    style: { setProperty: vi.fn() },
    animate: vi.fn(animate ?? (() => ({ finished: Promise.resolve() }))),
    remove: vi.fn(),
  };
  const createElement = vi.fn(() => el);
  const appendChild = vi.fn();
  vi.stubGlobal("window", {
    matchMedia: vi.fn((query: string) => ({ matches: reduced && query.includes("prefers-reduced-motion: reduce") })),
    getComputedStyle: () => ({ getPropertyValue: () => " 600ms" }),
  });
  vi.stubGlobal("document", { createElement, body: { appendChild }, documentElement: {} });
  const rect = { left: 10, top: 20, width: 100, height: 130 };
  const box = { getBoundingClientRect: () => rect } as unknown as Element;
  return { el, createElement, appendChild, box };
}

afterEach(() => vi.unstubAllGlobals());

describe("flyTo", () => {
  it("resolves at once and creates nothing under reduced motion", async () => {
    const { createElement, box } = setup({ reduced: true });
    await expect(flyTo(box, box, "var(--color-accent)")).resolves.toBeUndefined();
    expect(createElement).not.toHaveBeenCalled();
  });

  it("flies a temporary arch with the given colour, then removes it", async () => {
    const { el, appendChild, box } = setup({ reduced: false });
    await flyTo(box, box, "var(--color-accent)");
    expect(appendChild).toHaveBeenCalledWith(el);
    expect(el.style.setProperty).toHaveBeenCalledWith("--fly-color", "var(--color-accent)");
    expect(el.animate).toHaveBeenCalledTimes(1);
    expect(el.animate.mock.calls[0]?.[1]).toMatchObject({ duration: 600 });
    expect(el.remove).toHaveBeenCalledTimes(1);
  });

  it("removes its element even when the animation fails", async () => {
    const { el, box } = setup({
      reduced: false,
      animate: () => {
        throw new Error("boom");
      },
    });
    await expect(flyTo(box, box, "x")).resolves.toBeUndefined();
    expect(el.remove).toHaveBeenCalledTimes(1);
  });
});
