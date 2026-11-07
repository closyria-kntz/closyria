"use client";

import { useEffect } from "react";

/** Gap between the toast and the bar it rises above. */
const GAP_PX = 8;

/** How far from the bottom of the window the toast sits so it clears a bar whose top is at `barTop` (null: no bar). */
export function toastBottomFor(barTop: number | null, windowHeight: number): number | null {
  if (barTop === null || barTop >= windowHeight) return null;
  return Math.max(0, windowHeight - barTop) + GAP_PX;
}

/**
 * Lifts the undo toast above a bar stuck to the bottom of the page (« Préparer une commande »), so it never hides the
 * totals: sets `--toast-bottom` and `data-toast-lift` on <html> while the bar is shown, removed when it goes. `element`
 * comes from a callback ref, so the lift follows the bar even when it appears after a loading state.
 */
export function useToastLift(element: HTMLElement | null) {
  useEffect(() => {
    const root = document.documentElement;
    const clear = () => {
      root.removeAttribute("data-toast-lift");
      root.style.removeProperty("--toast-bottom");
    };
    if (!element) return clear;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bottom = toastBottomFor(element.getBoundingClientRect().top, window.innerHeight);
        if (bottom === null) return clear();
        root.setAttribute("data-toast-lift", "");
        root.style.setProperty("--toast-bottom", `${bottom}px`);
      });
    };
    update();
    // The bar moves when the content above it grows (rows loading), not only when it resizes itself.
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    observer.observe(document.body);
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, { capture: true });
      clear();
    };
  }, [element]);
}
