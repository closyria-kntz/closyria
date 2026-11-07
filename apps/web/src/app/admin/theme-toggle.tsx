"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { applyThemeMode, isThemeMode, nextThemeMode, readAppThemeMode, type ThemeMode } from "@/lib/theme-mode";
import { buttonClass } from "./ui";

const STORAGE_KEY = "closyria-admin-theme";

/**
 * Light / dark switch of the admin, through the existing theme mechanism: `data-theme` on <html>
 * (no attribute = the system's preference, see tokens.css). Remembered on this device only.
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
    <button type="button" className={buttonClass} onClick={change}>
      {t("toggle", { mode })}
    </button>
  );
}
