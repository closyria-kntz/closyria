"use client";

import { buttonClass } from "./ui";

export type MoveDirection = "up" | "down";

/** After a reorder the row has moved in the DOM: puts the focus back on the same button (or its twin at an end). */
export function focusMoved(id: string, direction: MoveDirection): void {
  const other = direction === "up" ? "down" : "up";
  queueMicrotask(() => {
    const target =
      document.querySelector<HTMLElement>(`[data-move="${id}:${direction}"]:not(:disabled)`) ??
      document.querySelector<HTMLElement>(`[data-move="${id}:${other}"]:not(:disabled)`);
    target?.focus();
  });
}

/**
 * « Monter » / « Descendre » for one row: the keyboard-accessible way to reorder (no drag and drop). Each button
 * names the row it moves. `labels` are the full accessible names.
 */
export function MoveButtons({
  id,
  index,
  count,
  upLabel,
  downLabel,
  onMove,
}: {
  id: string;
  index: number;
  count: number;
  upLabel: string;
  downLabel: string;
  onMove: (id: string, direction: MoveDirection) => void;
}) {
  return (
    <div className="flex gap-space-2">
      <button
        type="button"
        data-move={`${id}:up`}
        disabled={index === 0}
        aria-label={upLabel}
        onClick={() => onMove(id, "up")}
        className={`${buttonClass} min-h-touch-target min-w-touch-target justify-center disabled:opacity-40`}
      >
        <span aria-hidden="true">↑</span>
      </button>
      <button
        type="button"
        data-move={`${id}:down`}
        disabled={index === count - 1}
        aria-label={downLabel}
        onClick={() => onMove(id, "down")}
        className={`${buttonClass} min-h-touch-target min-w-touch-target justify-center disabled:opacity-40`}
      >
        <span aria-hidden="true">↓</span>
      </button>
    </div>
  );
}
