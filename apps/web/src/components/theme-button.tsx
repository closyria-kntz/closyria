"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { readAppThemeMode, saveAppThemeMode, shownTheme, THEME_CHANGE_EVENT } from "@/lib/theme-mode";
import { focusRing } from "./ui";

/** Light ↔ dark in one tap, kept on this device (same choice as Réglages → Apparence). No transition on the swap. */
export function ThemeButton() {
  const t = useTranslations("Shell.theme");
  // Read after mounting: the server does not know her device's choice.
  const [shown, setShown] = useState<"light" | "dark">("light");
  useEffect(() => {
    const read = () => setShown(shownTheme(readAppThemeMode()));
    read();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    window.addEventListener(THEME_CHANGE_EVENT, read);
    media.addEventListener("change", read);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, read);
      media.removeEventListener("change", read);
    };
  }, []);
  const dark = shown === "dark";
  return (
    <button
      type="button"
      aria-label={dark ? t("toLight") : t("toDark")}
      onClick={() => saveAppThemeMode(dark ? "light" : "dark")}
      className={`inline-flex size-touch-target shrink-0 items-center justify-center rounded-full text-ink hover:bg-surface-strong ${focusRing}`}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-space-5"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {dark ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        ) : (
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        )}
      </svg>
    </button>
  );
}
