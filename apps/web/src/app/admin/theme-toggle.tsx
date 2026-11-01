"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { isThemeMode, nextThemeMode, THEME_ID, type ThemeMode } from "./theme-mode";
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
    const root = document.documentElement;
    const id = THEME_ID[mode];
    if (id) root.dataset.theme = id;
    else delete root.dataset.theme;
    // Leaving the admin gives the rest of the site its own theme back.
    return () => {
      delete root.dataset.theme;
    };
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
