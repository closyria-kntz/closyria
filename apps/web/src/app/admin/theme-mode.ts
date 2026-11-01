import { atelierDark, atelierLight } from "@closyria/design-tokens";

export type ThemeMode = "system" | "light" | "dark";

const ORDER: ThemeMode[] = ["system", "light", "dark"];

/** The `data-theme` of each mode; none for "system" (tokens.css then follows the system preference). */
export const THEME_ID: Record<ThemeMode, string | null> = {
  system: null,
  light: atelierLight.id,
  dark: atelierDark.id,
};

/** The mode after `mode` in the cycle system → light → dark → system. */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length] as ThemeMode;
}

export const isThemeMode = (value: string | null): value is ThemeMode => ORDER.includes(value as ThemeMode);
