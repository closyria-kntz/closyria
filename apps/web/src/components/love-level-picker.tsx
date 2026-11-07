"use client";

import type { LoveLevel } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useLoveLevels } from "@/lib/profile-context";
import { focusRing } from "./ui";

const levelClass = `flex min-h-touch-target flex-col items-center justify-center gap-space-1 rounded-card border border-line bg-surface-raised px-space-1 py-space-3 text-sm text-ink hover:bg-surface-strong disabled:opacity-60 aria-pressed:border-accent aria-pressed:bg-hint aria-pressed:font-strong ${focusRing}`;

type Props = {
  /** Her level; null when the item has none. */
  value: LoveLevel | null;
  /** Called with the level she touched (the current one too: the caller decides whether that clears it). */
  onChange: (level: LoveLevel) => void;
  disabled?: boolean;
};

/** « Tu l’aimes comment ? »: her 4 levels (her own emoji and names) as big buttons, the chosen one pressed. */
export function LoveLevelPicker({ value, onChange, disabled = false }: Props) {
  const t = useTranslations("Item.keep");
  const levels = useLoveLevels();
  return (
    <fieldset className="flex min-w-space-0 flex-col gap-space-2">
      <legend className="pb-space-2 text-sm font-strong">{t("levels")}</legend>
      <div className="grid grid-cols-4 gap-space-2">
        {levels.map((level) => (
          <button
            key={level.level}
            type="button"
            disabled={disabled}
            aria-pressed={value === level.level}
            onClick={() => onChange(level.level)}
            className={levelClass}
          >
            <span aria-hidden="true" className="text-lead">
              {level.emoji}
            </span>
            <span className="max-w-full truncate">{level.label}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
