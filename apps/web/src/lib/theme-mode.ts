import { boudoirDark, boudoirLight } from "@closyria/design-tokens";

export type ThemeMode = "system" | "light" | "dark";

const ORDER: ThemeMode[] = ["system", "light", "dark"];

/** The `data-theme` of each mode; none for "system" (tokens.css then follows the system preference). */
export const THEME_ID: Record<ThemeMode, string | null> = {
  system: null,
  light: boudoirLight.id,
  dark: boudoirDark.id,
};

/** The mode after `mode` in the cycle system → light → dark → system. */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length] as ThemeMode;
}

export const isThemeMode = (value: string | null): value is ThemeMode => ORDER.includes(value as ThemeMode);

/** Her choice in Réglages → Apparence, on this device. The same key is read by public/theme-init.js. */
export const APP_THEME_KEY = "closyria-theme";

/** Her saved choice, "system" when none (or when the storage cannot be read). */
export function readAppThemeMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(APP_THEME_KEY);
    return isThemeMode(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

/** Puts `mode` on <html> (no `data-theme` = the system's preference, see tokens.css). */
export function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement;
  const id = THEME_ID[mode];
  if (id) root.dataset.theme = id;
  else delete root.dataset.theme;
}

/** Saves and applies her choice. */
export function saveAppThemeMode(mode: ThemeMode): void {
  try {
    if (mode === "system") window.localStorage.removeItem(APP_THEME_KEY);
    else window.localStorage.setItem(APP_THEME_KEY, mode);
  } catch {
    // Private browsing: applied for this visit only.
  }
  applyThemeMode(mode);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

/** Fired after every saved choice, so the top bar button and Réglages → Apparence stay in step. */
export const THEME_CHANGE_EVENT = "closyria-theme-change";

/** The theme really shown now: her explicit choice, else what the device prefers. */
export function shownTheme(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") return mode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
