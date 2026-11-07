import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { nextThemeMode } from "../../lib/theme-mode";
import { isPaletteShortcut } from "./keyboard";

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

describe("admin page guard", () => {
  it("is called by every admin page, not only by the layouts", () => {
    const root = fileURLToPath(new URL(".", import.meta.url));
    const pages = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith("page.tsx"));
    expect(pages.length).toBeGreaterThanOrEqual(3);
    for (const page of pages) {
      expect(readFileSync(join(root, page), "utf8"), page).toMatch(/await requireAdminPage\(/);
    }
  });
});
