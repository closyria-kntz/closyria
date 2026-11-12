"use client";

import type { LoveLevel, LoveLevelView } from "@closyria/shared";
import { useEffect, useRef } from "react";
import { stepFocus } from "./level-picker-logic";
import { focusRing } from "./ui";

/**
 * The small bubble with her 4 levels (emoji, her own name as the accessible name). Opens on the current
 * level; Escape or a click outside closes it without changing anything, and focus goes back to `anchor`.
 */
export function LevelPicker({
  levels,
  value,
  onPick,
  onClose,
  anchor,
  label,
}: {
  levels: readonly LoveLevelView[];
  value: LoveLevel | null;
  onPick: (level: LoveLevel) => void;
  onClose: () => void;
  anchor: HTMLElement;
  /** « Ton niveau d'envie pour {nom} ». */
  label: string;
}) {
  const group = useRef<HTMLDivElement>(null);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const close = useRef(onClose);
  close.current = onClose;
  const current = Math.max(
    0,
    levels.findIndex((level) => level.level === value),
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: focus once, when the bubble opens.
  useEffect(() => {
    buttons.current[current]?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (group.current?.contains(target) || anchor.contains(target)) return;
      close.current();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close.current();
      anchor.focus();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", onEscape);
    };
  }, [anchor]);

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      className="level-picker bg-surface-raised shadow-lifted absolute top-1/3 left-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 gap-space-1 rounded-full p-space-1"
    >
      {levels.map((level, index) => (
        // biome-ignore lint/a11y/useSemanticElements: a round emoji button in a radiogroup (a native radio cannot be styled so).
        <button
          key={level.level}
          ref={(node) => {
            buttons.current[index] = node;
          }}
          type="button"
          role="radio"
          aria-checked={level.level === value}
          aria-label={level.label}
          title={level.label}
          tabIndex={index === current ? 0 : -1}
          onClick={() => onPick(level.level)}
          onKeyDown={(event) => {
            const next = stepFocus(index, event.key, levels.length);
            if (next === null) return;
            event.preventDefault();
            buttons.current[next]?.focus();
          }}
          className={`flex size-touch-target items-center justify-center rounded-full text-lead hover:bg-hint aria-checked:bg-hint ${focusRing}`}
        >
          <span aria-hidden="true">{level.emoji}</span>
        </button>
      ))}
    </div>
  );
}

/** A few champagne sparks around the emoji (the highest level only; the caller never renders them in reduced motion). */
export function LevelSparks({ onDone }: { onDone: () => void }) {
  return (
    <span
      data-testid="level-sparks"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      {[0, 1, 2, 3, 4, 5].map((spark) => (
        <span
          key={spark}
          onAnimationEnd={spark === 0 ? onDone : undefined}
          className="level-spark absolute size-space-2 rounded-full bg-detail"
        />
      ))}
    </span>
  );
}
