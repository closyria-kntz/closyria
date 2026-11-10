"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { focusRing } from "./ui";

/** The nearest ancestor that scrolls (the app's content area), else the window's own scrolling element. */
function scrollerOf(element: HTMLElement | null): HTMLElement {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node !== document.body) return node;
  }
  return document.scrollingElement as HTMLElement;
}

/**
 * « Haut de page »: a round button that shows once she has scrolled down more than one screen, in the bottom right
 * corner of the area that scrolls (so above the phone tab bar and the home indicator). It goes back to the top
 * (smoothly unless reduced motion is asked) and moves the focus to the page's title. Placed last in a page's column.
 */
export function BackToTop() {
  const t = useTranslations("BackToTop");
  const anchor = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const scroller = scrollerOf(anchor.current);
    // The window scrolls through its scrolling element, but tells it on the window.
    const target: HTMLElement | Window = scroller === document.scrollingElement ? window : scroller;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const height = scroller === document.scrollingElement ? window.innerHeight : scroller.clientHeight;
        setShown(scroller.scrollTop > height);
      });
    };
    update();
    target.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      target.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  function goUp() {
    const scroller = scrollerOf(anchor.current);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    // The title of the page it sits in (the app's content area, or a page of its own such as a shared link).
    const title = (anchor.current?.closest("main") ?? document).querySelector<HTMLElement>("h1");
    if (title) {
      if (!title.hasAttribute("tabindex")) title.setAttribute("tabindex", "-1");
      title.focus({ preventScroll: true });
    }
  }

  return (
    <div ref={anchor} className="pointer-events-none bottom-safe-4 sticky z-10 h-space-0 self-end">
      {shown && (
        <button
          type="button"
          onClick={goUp}
          className={`pointer-events-auto absolute right-space-0 bottom-space-0 inline-flex whitespace-nowrap min-h-touch-target items-center gap-space-2 rounded-full border border-line bg-surface-raised px-space-4 text-sm font-strong text-ink shadow-lifted ${focusRing}`}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="size-space-4"
          >
            <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
          </svg>
          {t("label")}
        </button>
      )}
    </div>
  );
}
