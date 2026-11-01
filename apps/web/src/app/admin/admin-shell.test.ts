import { describe, expect, it } from "vitest";
import { isPaletteShortcut } from "./keyboard";
import { nextThemeMode } from "./theme-mode";

const key = (k: string, mods: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods,
});

describe("isPaletteShortcut", () => {
  it("opens on ⌘K and Ctrl+K, in either case", () => {
    expect(isPaletteShortcut(key("k", { metaKey: true }))).toBe(true);
    expect(isPaletteShortcut(key("K", { ctrlKey: true }))).toBe(true);
  });

  it("ignores K alone, other keys and Alt combinations", () => {
    expect(isPaletteShortcut(key("k"))).toBe(false);
    expect(isPaletteShortcut(key("j", { metaKey: true }))).toBe(false);
    expect(isPaletteShortcut(key("k", { ctrlKey: true, altKey: true }))).toBe(false);
  });
});

describe("nextThemeMode", () => {
  it("cycles system, light, dark", () => {
    expect(nextThemeMode("system")).toBe("light");
    expect(nextThemeMode("light")).toBe("dark");
    expect(nextThemeMode("dark")).toBe("system");
  });
});
