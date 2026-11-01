import { describe, expect, it } from "vitest";
import { atelierDark, atelierLight, primitives, renderThemeCss, renderTokensCss, themeSchema } from "./index";

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe("renderThemeCss", () => {
  const css = renderThemeCss(atelierLight);

  it("emits semantic variables under the theme selector", () => {
    expect(css).toContain('[data-theme="atelier-light"]');
    expect(css).toContain("--color-surface:");
  });

  it("never leaks primitive keys", () => {
    for (const key of Object.keys(primitives.palette)) {
      expect(css).not.toContain(`--palette-${key}`);
      expect(css).not.toContain(`--${key}:`);
    }
    expect(css).not.toContain("--palette");
  });

  it("zeroes motion durations under prefers-reduced-motion", () => {
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*--motion-duration-base: 0ms/);
  });
});

describe("renderTokensCss", () => {
  const css = renderTokensCss();

  it("resets the Tailwind theme and declares defaults on :root", () => {
    expect(css).toContain("@theme static");
    expect(css).toContain("--*: initial;");
  });

  it("covers both themes and the system dark preference", () => {
    expect(css).toContain('[data-theme="atelier-dark"]');
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toContain(':root:not([data-theme="atelier-light"])');
  });
});

describe("themeSchema", () => {
  it("accepts the built-in themes", () => {
    expect(themeSchema.parse(atelierLight).id).toBe("atelier-light");
    expect(themeSchema.parse(atelierDark).base).toBe("dark");
  });

  it("rejects a theme with an unknown token key", () => {
    const bad = { id: "x", name: "X", base: "light", tokens: { "color-nope": "#000" } };
    expect(themeSchema.safeParse(bad).success).toBe(false);
  });

  it("validates the reserved decoration set", () => {
    const decorations = {
      illustrations: [{ id: "snow", url: "https://cdn.example/snow.svg", placement: "hero", alt: "Neige" }],
      animations: [{ id: "flakes", url: "https://cdn.example/flakes.json", placement: "background" }],
      headerImages: [{ id: "banner", url: "https://cdn.example/banner.webp", placement: "header" }],
      catchphrases: { fr: "Joyeux Noël", en: "Merry Christmas" },
    };
    const ok = { id: "noel", name: "Noël", base: "light", tokens: {}, decorations };
    expect(themeSchema.safeParse(ok).success).toBe(true);
    const bad = { ...ok, decorations: { illustrations: [{ id: "snow", url: "not a url", placement: "hero" }] } };
    expect(themeSchema.safeParse(bad).success).toBe(false);
  });
});

describe("provisional themes", () => {
  it.each([atelierLight, atelierDark])("keeps AA contrast in $id", (theme) => {
    const t = theme.tokens;
    expect(contrast(t["color-ink"] as string, t["color-surface"] as string)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["color-accent-ink"] as string, t["color-accent"] as string)).toBeGreaterThanOrEqual(4.5);
  });
});
