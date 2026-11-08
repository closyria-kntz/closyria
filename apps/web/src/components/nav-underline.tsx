"use client";

import { usePathname } from "next/navigation";
import { type RefObject, useEffect, useRef } from "react";

/**
 * The raspberry line that slides under the current place of a bar. It looks for `activeSelector` inside the
 * container, and follows the element when the page changes, the bar resizes or the fonts arrive. Its place goes
 * through two custom properties (no inline pixel in the markup); the slide uses the motion tokens, so reduced
 * motion makes it instant. The container must be `relative`.
 */
export function NavUnderline({
  containerRef,
  activeSelector,
}: {
  containerRef: RefObject<HTMLElement | null>;
  activeSelector: string;
}) {
  const line = useRef<HTMLSpanElement>(null);
  const pathname = usePathname();
  // biome-ignore lint/correctness/useExhaustiveDependencies: placed again on every navigation.
  useEffect(() => {
    const container = containerRef.current;
    const element = line.current;
    if (!container || !element) return;
    let watched: Element | null = null;
    const place = () => {
      const active = container.querySelector(activeSelector);
      if (active !== watched) {
        if (watched) resize.unobserve(watched);
        if (active) resize.observe(active);
        watched = active;
      }
      if (!active) {
        element.dataset.shown = "false";
        return;
      }
      const box = container.getBoundingClientRect();
      const target = active.getBoundingClientRect();
      // In the container's own coordinates: a bar that scrolls sideways carries the line with its content.
      element.style.setProperty("--underline-x", `${target.left - box.left + container.scrollLeft}px`);
      element.style.setProperty("--underline-width", `${target.width}px`);
      element.dataset.shown = "true";
    };
    const resize = new ResizeObserver(place);
    resize.observe(container);
    const mutations = new MutationObserver(place);
    mutations.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-current"],
    });
    place();
    // The first placement is instant; the slide starts once the line is in place.
    const frame = requestAnimationFrame(() => {
      element.dataset.ready = "true";
    });
    void document.fonts?.ready.then(place);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
    };
  }, [containerRef, activeSelector, pathname]);
  return (
    <span
      ref={line}
      aria-hidden="true"
      data-testid="nav-underline"
      data-shown="false"
      className="pointer-events-none absolute bottom-space-1 left-(--underline-x) h-space-1 w-(--underline-width) rounded-full bg-accent opacity-0 data-[ready=true]:transition-all data-[ready=true]:duration-base data-[ready=true]:ease-standard data-[shown=true]:opacity-100"
    />
  );
}
