import { describe, expect, it } from "vitest";
import {
  defaultSemanticTokens,
  equilibreDark,
  equilibreLight,
  primitives,
  renderThemeCss,
  renderTokensCss,
  type Theme,
  themeSchema,
} from "./index";

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
  const css = renderThemeCss(equilibreLight);

  it("emits semantic variables under the theme selector", () => {
    expect(css).toContain('[data-theme="equilibre-light"]');
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
    expect(css).toContain('[data-theme="equilibre-dark"]');
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toContain(':root:not([data-theme="equilibre-light"])');
  });
});

describe("themeSchema", () => {
  it("accepts the built-in themes", () => {
    expect(themeSchema.parse(equilibreLight).id).toBe("equilibre-light");
    expect(themeSchema.parse(equilibreDark).base).toBe("dark");
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

describe("Équilibré themes", () => {
  const themes = [equilibreLight, equilibreDark];
  const get = (theme: Theme, key: string) => (theme.tokens as Record<string, string>)[key] as string;

  it("never mentions the provisional charter", () => {
    expect(renderTokensCss().toLowerCase()).not.toContain("atelier");
    expect(themes.map((theme) => theme.id)).toEqual(["equilibre-light", "equilibre-dark"]);
  });

  it("uses the exact validated palette", () => {
    expect(get(equilibreLight, "color-surface")).toBe("#F2EDE7");
    expect(get(equilibreLight, "color-surface-raised")).toBe("#FFFFFF");
    expect(get(equilibreLight, "color-surface-sunken")).toBe("#EBE3DB");
    expect(get(equilibreLight, "color-line")).toBe("#E5D7CC");
    expect(get(equilibreLight, "color-ink")).toBe("#4A332A");
    expect(get(equilibreLight, "color-ink-muted")).toBe("#6E5A50");
    expect(get(equilibreLight, "color-accent")).toBe("#5A3A2E");
    expect(get(equilibreLight, "color-accent-ink")).toBe("#FFFFFF");
    expect(get(equilibreLight, "color-hint")).toBe("#EBC7C3");
    expect(get(equilibreLight, "color-premium-surface")).toBe("#F3E3A6");
    expect(get(equilibreLight, "color-success-surface")).toBe("#D5DCC8");
    expect(get(equilibreLight, "color-media-backdrop")).toBe("#EADBC8");
    // « Préparer une commande » band (version B): very light pink, a pink edge, a milk-chocolate button.
    expect(get(equilibreLight, "color-band")).toBe("#F6E4E1");
    expect(get(equilibreLight, "color-band-line")).toBe("#D8A9A3");
    expect(get(equilibreLight, "color-band-button")).toBe("#7A5444");
    expect(get(equilibreLight, "color-band-button-ink")).toBe("#FFFFFF");
    // Budget pills (version B, 2026-11-07): a soft fill and an edge, the same for green and red.
    expect(get(equilibreLight, "color-success-soft")).toBe("#E3F1E7");
    expect(get(equilibreLight, "color-success-edge")).toBe("#6FA58A");
    expect(get(equilibreLight, "color-danger-soft")).toBe("#FBE3E6");
    expect(get(equilibreLight, "color-danger-edge")).toBe("#D97F8C");
    expect(get(equilibreDark, "color-success-soft")).toBe("#1D3A31");
    expect(get(equilibreDark, "color-success-edge")).toBe("#4E8A6E");
    expect(get(equilibreDark, "color-danger-soft")).toBe("#4A2228");
    expect(get(equilibreDark, "color-danger-edge")).toBe("#B4646C");
    expect(get(equilibreDark, "color-surface")).toBe("#1E1612");
    expect(get(equilibreDark, "color-surface-raised")).toBe("#2A201B");
    expect(get(equilibreDark, "color-ink")).toBe("#DDD0C6");
    expect(get(equilibreDark, "color-ink-muted")).toBe("#B5A398");
    expect(get(equilibreDark, "color-accent")).toBe("#EBC7C3");
    expect(get(equilibreDark, "color-accent-ink")).toBe("#2B1D17");
  });

  it("defines the specified shapes, durations and fonts", () => {
    const base = defaultSemanticTokens;
    expect(base["radius-button"]).toBe("9999px");
    expect(base["radius-card"]).toBe("1.625rem");
    expect(base["radius-full"]).toBe("9999px");
    expect(base["motion-duration-fast"]).toBe("150ms");
    expect(base["motion-duration-base"]).toBe("250ms");
    expect(base["motion-duration-slow"]).toBe("400ms");
    expect(base["font-body"]).toContain("DM Sans");
    expect(base["font-display"]).toContain("Fraunces");
  });

  const textPairs: [string, string, number][] = [
    ["color-ink", "color-surface", 4.5],
    ["color-ink", "color-surface-raised", 4.5],
    ["color-ink", "color-surface-strong", 4.5],
    ["color-ink-muted", "color-surface", 4.5],
    ["color-ink-muted", "color-surface-raised", 4.5],
    ["color-ink-muted", "color-surface-sunken", 4.5],
    ["color-ink-muted", "color-media-backdrop", 4.5],
    ["color-ink", "color-hint", 4.5],
    ["color-accent-ink", "color-accent", 4.5],
    ["color-accent", "color-surface", 4.5],
    ["color-success", "color-success-surface", 4.5],
    ["color-premium", "color-premium-surface", 4.5],
    ["color-danger", "color-surface", 4.5],
    ["color-danger", "color-surface-raised", 4.5],
    ["color-danger", "color-surface-sunken", 4.5],
    ["color-success", "color-surface", 4.5],
    ["color-focus-ring", "color-surface", 4.5],
    ["color-focus-ring", "color-surface-raised", 4.5],
    ["color-focus-ring", "color-surface-sunken", 3],
    ["color-line", "color-surface", 1],
    ["color-ink", "color-band", 4.5],
    ["color-band-button-ink", "color-band-button", 4.5],
    ["color-surface", "color-danger", 4.5],
    ["color-band-line", "color-band", 1.2],
    ["color-success", "color-success-soft", 4.5],
    ["color-danger", "color-danger-soft", 4.5],
    ["color-success-edge", "color-band", 2],
    ["color-danger-edge", "color-band", 2],
  ];

  describe.each(themes)("$id", (theme) => {
    it.each(textPairs)("%s on %s reaches %d:1", (fg, bg, min) => {
      expect(contrast(get(theme, fg), get(theme, bg))).toBeGreaterThanOrEqual(min);
    });
  });
});

describe("adaptive layout tokens", () => {
  const base = defaultSemanticTokens;

  it("lets the content grow up to 90rem, with a 70ch reading measure and 44px touch targets", () => {
    expect(base["container-app"]).toBe("90rem");
    expect(base["container-measure"]).toBe("70ch");
    expect(base["spacing-touch-target"]).toBe("44px");
  });

  it("grows the text with the screen between the phone and the large breakpoint", () => {
    for (const key of ["text-body", "text-lead", "text-title", "text-display"] as const) {
      expect(base[key]).toMatch(/^clamp\(/);
    }
    expect(base["text-sm"]).not.toMatch(/clamp/);
  });

  it("runs every fluid size exactly from its minimum at 20rem to its maximum at 64rem", () => {
    const at = (clamp: string, rem: number): number => {
      const m = /^clamp\(([\d.]+)rem, ([\d.]+)rem \+ ([\d.]+)vw, ([\d.]+)rem\)$/.exec(clamp);
      if (!m) throw new Error(`unexpected clamp ${clamp}`);
      const [min, intercept, slope, max] = m.slice(1).map(Number) as [number, number, number, number];
      return Math.min(max, Math.max(min, intercept + (slope * rem) / 100));
    };
    const ranges: Record<string, [number, number]> = {
      "text-body": [1, 1.125],
      "text-lead": [1.25, 1.5],
      "text-title": [1.75, 2.5],
      "text-display": [2.5, 4],
    };
    for (const [key, [min, max]] of Object.entries(ranges)) {
      const value = base[key as keyof typeof base];
      expect(Math.abs(at(value, 20) - min), `${key} at 20rem`).toBeLessThanOrEqual(0.01);
      expect(Math.abs(at(value, 64) - max), `${key} at 64rem`).toBeLessThanOrEqual(0.01);
      // The unclamped line itself must hit both ends (no early plateau): halfway is halfway.
      expect(Math.abs(at(value, 42) - (min + max) / 2), `${key} at 42rem`).toBeLessThanOrEqual(0.01);
    }
  });

  it("emits them in the generated stylesheet", () => {
    const css = renderTokensCss();
    expect(css).toContain("--container-app: 90rem;");
    expect(css).toContain("--text-display: clamp(");
  });
});
