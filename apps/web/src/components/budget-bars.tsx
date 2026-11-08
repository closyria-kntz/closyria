"use client";

import { useEffect, useRef } from "react";

/**
 * The two-colour bar of a budget: what is already ordered (grey) then the order in progress (green, red when it would
 * pass the budget). The widths go through custom properties (no inline pixel in the markup).
 */
export function BudgetBars({ spentPct, pickPct, overBar }: { spentPct: number; pickPct: number; overBar: boolean }) {
  const bars = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bars.current?.style.setProperty("--spent-width", `${spentPct}%`);
    bars.current?.style.setProperty("--pick-width", `${pickPct}%`);
  }, [spentPct, pickPct]);
  return (
    <div
      aria-hidden="true"
      data-testid="budget-bars"
      data-over={overBar}
      ref={bars}
      className="flex h-space-2 overflow-hidden rounded-full bg-surface-sunken"
    >
      <span className="w-(--spent-width) bg-ink-muted/55 transition-all duration-slow ease-standard" />
      <span
        className={`w-(--pick-width) transition-all duration-slow ease-standard ${overBar ? "bg-danger" : "bg-success"}`}
      />
    </div>
  );
}
