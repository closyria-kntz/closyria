"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { applyThemeMode, isThemeMode, nextThemeMode, readAppThemeMode, type ThemeMode } from "@/lib/theme-mode";
import { focusRing } from "./ui";

const STORAGE_KEY = "closyria-admin-theme";

/** A round, finger-wide icon button of the bar: the input's border and fill. */
const iconButtonClass = `inline-flex size-touch-target shrink-0 items-center justify-center rounded-button border border-line bg-surface-raised text-ink hover:bg-surface-strong ${focusRing}`;

/** The current mode, drawn: a half-filled disc (the system's), a sun (light), a moon (dark). */
function ThemeIcon({ mode }: { mode: ThemeMode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-nav-icon shrink-0"
    >
      {mode === "light" ? (
        <>
          <circle cx="10" cy="10" r="3.5" />
          <path d="M10 2.5v1.5M10 16v1.5M2.5 10H4M16 10h1.5M4.7 4.7l1 1M14.3 14.3l1 1M4.7 15.3l1-1M14.3 5.7l1-1" />
        </>
      ) : mode === "dark" ? (
        <path d="M16 12.2A6.5 6.5 0 0 1 7.8 4a6.5 6.5 0 1 0 8.2 8.2z" />
      ) : (
        <>
          <circle cx="10" cy="10" r="6.5" />
          <path d="M10 3.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

/**
 * Light / dark switch of the admin, through the existing theme mechanism: `data-theme` on <html>
 * (no attribute = the system's preference, see tokens.css). Remembered on this device only. An icon button: the
 * mode and the action are its accessible name (and its tooltip), so the bar stays one line high on a phone.
 */
export function ThemeToggle() {
  const t = useTranslations("Admin.theme");
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isThemeMode(stored)) setMode(stored);
  }, []);

  useEffect(() => {
    applyThemeMode(mode);
    // Leaving the admin gives the rest of the site its own theme back (her choice in Réglages → Apparence).
    return () => applyThemeMode(readAppThemeMode());
  }, [mode]);

  const change = () => {
    const next = nextThemeMode(mode);
    window.localStorage.setItem(STORAGE_KEY, next);
    setMode(next);
  };

  return (
    <button
      type="button"
      className={iconButtonClass}
      aria-label={t("toggle", { mode })}
      title={t("toggle", { mode })}
      onClick={change}
    >
      <ThemeIcon mode={mode} />
    </button>
  );
}
