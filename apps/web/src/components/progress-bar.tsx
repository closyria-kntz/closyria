"use client";

import { useEffect, useRef } from "react";

/**
 * A thin bar filled to `share` percent (mockup: 6 px, the line's colour, the accent's fill): the budget already
 * ordered, the way to free shipping. Decorative, the text next to it says the same; its width goes through a custom
 * property (no inline value).
 */
export function ProgressBar({ share, className = "" }: { share: number; className?: string }) {
  const bar = useRef<HTMLSpanElement>(null);
  const width = Math.max(0, Math.min(100, Math.round(share)));
  useEffect(() => {
    bar.current?.style.setProperty("--bar-share", `${width}%`);
  }, [width]);
  return (
    <span
      ref={bar}
      aria-hidden="true"
      data-share={width}
      className={`block h-bar overflow-hidden rounded-pill bg-line ${className}`}
    >
      <span className="block h-full w-(--bar-share,0) rounded-pill bg-une-ink" />
    </span>
  );
}
