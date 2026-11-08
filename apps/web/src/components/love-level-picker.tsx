"use client";

import type { LoveLevel } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useLoveLevels } from "@/lib/profile-context";
import { levelButtonClass } from "./ui";

type Props = {
  /** Her level; null when the item has none. */
  value: LoveLevel | null;
  /** Called with the level she touched (the current one too: the caller decides whether that clears it). */
  onChange: (level: LoveLevel) => void;
  disabled?: boolean;
  /** The question read aloud only, under a heading that already names the block (« Ton envie »). */
  hideLegend?: boolean;
};

/** « Tu l’aimes comment ? »: her 4 levels (her own emoji and names) as big buttons, the chosen one pressed. */
export function LoveLevelPicker({ value, onChange, disabled = false, hideLegend = false }: Props) {
  const t = useTranslations("Item.keep");
  const levels = useLoveLevels();
  return (
    <fieldset className="flex min-w-space-0 flex-col gap-space-2">
      <legend className={hideLegend ? "sr-only" : "pb-space-2 text-sm font-strong"}>{t("levels")}</legend>
      <div className="grid grid-cols-2 gap-space-2 sm:grid-cols-(--grid-levels)">
        {levels.map((level) => (
          <button
            key={level.level}
            type="button"
            disabled={disabled}
            aria-pressed={value === level.level}
            onClick={() => onChange(level.level)}
            className={levelButtonClass}
          >
            <span aria-hidden="true" className="text-emoji-level leading-none">
              {level.emoji}
            </span>
            <span className="max-w-full truncate">{level.label}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
