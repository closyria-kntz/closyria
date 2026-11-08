"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { readAppThemeMode, saveAppThemeMode, THEME_CHANGE_EVENT, type ThemeMode } from "@/lib/theme-mode";

const MODES: readonly ThemeMode[] = ["system", "light", "dark"];

/** Réglages → Apparence: like the phone or computer, always light, or always dark. Kept on this device. */
export function AppearanceSettings() {
  const t = useTranslations("Settings.appearance");
  // Read after mounting: the server does not know her device's choice.
  const [mode, setMode] = useState<ThemeMode | null>(null);
  useEffect(() => {
    const read = () => setMode(readAppThemeMode());
    read();
    // The top bar button changes the same choice.
    window.addEventListener(THEME_CHANGE_EVENT, read);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, read);
  }, []);

  const choose = (next: ThemeMode) => {
    saveAppThemeMode(next);
    setMode(next);
  };

  return (
    <section className="flex max-w-measure flex-col gap-space-4">
      <h2 className="font-display text-lead font-strong">{t("title")}</h2>
      <fieldset className="flex flex-col gap-space-2">
        <legend className="mb-space-2 text-ink-muted">{t("intro")}</legend>
        {MODES.map((option) => (
          <label
            key={option}
            className="flex min-h-touch-target cursor-pointer items-center gap-space-3 rounded-card border border-line bg-surface-raised px-space-4 py-space-3 has-checked:border-accent has-checked:font-strong has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring has-focus-visible:outline-solid"
          >
            <input
              type="radio"
              name="appearance"
              value={option}
              checked={mode === option}
              onChange={() => choose(option)}
              className="size-space-5 accent-accent"
            />
            <span className="flex flex-col">
              <span>{t(`modes.${option}.label`)}</span>
              <span className="text-sm font-normal text-ink-muted">{t(`modes.${option}.hint`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}
