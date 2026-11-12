import { describe, expect, it } from "vitest";
import {
  boudoirDark,
  boudoirLight,
  defaultSemanticTokens,
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
  const css = renderThemeCss(boudoirLight);

  it("emits semantic variables under the theme selector", () => {
    expect(css).toContain('[data-theme="boudoir-light"]');
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
    expect(css).toContain('[data-theme="boudoir-dark"]');
    expect(css).toContain("prefers-color-scheme: dark");
    // The browser draws scroll bars and native controls in the theme's scheme.
    expect(css).toContain("color-scheme: light;");
    expect(css).toContain("color-scheme: dark;");
    expect(css).toContain(':root:not([data-theme="boudoir-light"])');
  });
});

describe("themeSchema", () => {
  it("accepts the built-in themes", () => {
    expect(themeSchema.parse(boudoirLight).id).toBe("boudoir-light");
    expect(themeSchema.parse(boudoirDark).base).toBe("dark");
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

describe("Boudoir themes", () => {
  const themes = [boudoirLight, boudoirDark];
  const get = (theme: Theme, key: string) => (theme.tokens as Record<string, string>)[key] as string;

  it("never mentions the provisional charter", () => {
    expect(renderTokensCss().toLowerCase()).not.toContain("atelier");
    expect(themes.map((theme) => theme.id)).toEqual(["boudoir-light", "boudoir-dark"]);
  });

  it("emits the validated surface and accent in the generated stylesheet", () => {
    const css = renderTokensCss();
    // Light on :root (Tailwind's @theme) and under its own selector.
    expect(css).toContain("--color-surface: #FBF7F4;");
    expect(css).toContain("--color-accent: #5B1A2A;");
    // Dark (validated on 2026-11-11) under its selector and the system preference.
    const dark = renderThemeCss(boudoirDark);
    expect(dark).toContain("--color-surface: #1C0F12;");
    expect(dark).toContain("--color-accent: #F3D6DA;");
    expect(dark).toContain("--color-ink: #F6E9EA;");
    expect(css).toMatch(/prefers-color-scheme: dark\)[\s\S]*--color-surface: #1C0F12;/);
  });

  it("uses the exact validated palette", () => {
    // Boudoir (docs/specs/2026-11-11-refonte-boudoir.md, section 4; dark values validated on 2026-11-11).
    const expected: [string, string, string][] = [
      ["color-surface", "#FBF7F4", "#1C0F12"],
      ["color-surface-raised", "#FFFFFF", "#2A171B"],
      ["color-surface-sunken", "#F6E6E3", "#351D22"],
      ["color-line", "#ECDCD9", "#43282E"],
      ["color-ink", "#2B1418", "#F6E9EA"],
      // #86686D in the mockup, darkened in the same hue for AA on the soft fills (ruling of 2026-11-11).
      ["color-ink-muted", "#755A5F", "#C2A6AB"],
      ["color-accent", "#5B1A2A", "#F3D6DA"],
      ["color-accent-ink", "#FFFFFF", "#2B1418"],
      ["color-button-bg", "#5B1A2A", "#F3D6DA"],
      ["color-button-ink", "#FFFFFF", "#2B1418"],
      ["color-focus-ring", "#8C2A3C", "#F0A9B6"],
      ["color-hint", "#F3D6DA", "#4A2730"],
      ["color-selected-surface", "#F3D6DA", "#4A2730"],
      ["color-detail", "#D9A441", "#D9A441"],
      ["color-label", "#D9A441", "#D9A441"],
      ["color-label-ink", "#2B1418", "#2B1418"],
      ["color-band", "#5B1A2A", "#3A1119"],
      ["color-band-ink", "#FFFFFF", "#F6E9EA"],
      ["color-une", "#F3D6DA", "#4A2730"],
      ["color-tip", "#FFF1D6", "#3A2E12"],
      ["color-tip-ink", "#5A3D00", "#F5DFA8"],
    ];
    for (const [key, light, dark] of expected) {
      expect(get(boudoirLight, key), `${key} light`).toBe(light);
      expect(get(boudoirDark, key), `${key} dark`).toBe(dark);
    }
    // Success, danger and the budget pills are unchanged.
    expect(get(boudoirLight, "color-success-soft")).toBe("#E3F1E7");
    expect(get(boudoirLight, "color-success-edge")).toBe("#6FA58A");
    expect(get(boudoirLight, "color-danger-soft")).toBe("#FBE3E6");
    expect(get(boudoirLight, "color-danger-edge")).toBe("#D97F8C");
    expect(get(boudoirDark, "color-success-soft")).toBe("#1D3A31");
    expect(get(boudoirDark, "color-success-edge")).toBe("#4E8A6E");
    expect(get(boudoirDark, "color-danger-soft")).toBe("#4A2228");
    expect(get(boudoirDark, "color-danger-edge")).toBe("#B4646C");
  });

  it("drops the « Cocon » direction: no aurora, no frosted glass, no arched photos", () => {
    const css = renderTokensCss();
    for (const retired of [
      "aurora",
      "--color-glass",
      "--blur-glass",
      "--saturate-glass",
      "--radius-photo-",
      "--radius-thumb-",
    ])
      expect(css).not.toContain(retired);
  });

  it("defines the specified shapes, durations and fonts", () => {
    const base = defaultSemanticTokens;
    // Cards 20 px, pills and buttons fully round.
    expect(base["radius-card"]).toBe("1.25rem");
    expect(base["radius-pill"]).toBe("999px");
    expect(base["radius-button"]).toBe("9999px");
    expect(base["radius-full"]).toBe("9999px");
    // Boudoir photos are plain rounded rectangles: no arch, no « shape C ».
    expect(base).not.toHaveProperty("radius-arch");
    expect(base).not.toHaveProperty("radius-photo-top");
    expect(base["motion-duration-fast"]).toBe("150ms");
    expect(base["motion-duration-base"]).toBe("250ms");
    expect(base["motion-duration-slow"]).toBe("400ms");
    // Gloock for titles and item names, Figtree for the text; `font-display` stays an alias of the title font.
    expect(base["font-title"]).toMatch(/^"Gloock"/);
    expect(base["font-display"]).toBe(base["font-title"]);
    expect(base["font-body"]).toMatch(/^"Figtree Variable"/);
    const css = renderTokensCss();
    expect(css).toContain('--font-title: "Gloock"');
    expect(css).toContain('--font-body: "Figtree Variable"');
    expect(css).not.toMatch(/Fraunces|Jost/);
  });

  const textPairs: [string, string, number][] = [
    ["color-ink", "color-surface", 4.5],
    ["color-ink", "color-surface-raised", 4.5],
    ["color-ink", "color-surface-sunken", 4.5],
    ["color-ink", "color-surface-strong", 4.5],
    ["color-ink-muted", "color-surface", 4.5],
    ["color-ink-muted", "color-surface-raised", 4.5],
    ["color-ink-muted", "color-surface-sunken", 4.5],
    ["color-ink-muted", "color-media-backdrop", 4.5],
    ["color-ink", "color-hint", 4.5],
    ["color-accent-ink", "color-accent", 4.5],
    ["color-accent", "color-surface", 4.5],
    ["color-accent", "color-surface-raised", 4.5],
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
    ["color-band-ink", "color-band", 4.5],
    ["color-label-ink", "color-label", 4.5],
    ["color-band-button-ink", "color-band-button", 4.5],
    ["color-band-button-ink", "color-band-button-hover", 4.5],
    ["color-button-ink", "color-button-bg", 4.5],
    ["color-surface", "color-danger", 4.5],
    ["color-ink", "color-selected-surface", 4.5],
    ["color-ink-muted", "color-selected-surface", 4.5],
    ["color-accent", "color-selected-surface", 4.5],
    ["color-success", "color-success-soft", 4.5],
    ["color-danger", "color-danger-soft", 4.5],
    ["color-success-edge", "color-surface-raised", 2],
    ["color-danger-edge", "color-surface-raised", 2],
    ["color-ink", "color-une", 4.5],
    ["color-tip-ink", "color-tip", 4.5],
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
    // The item preview panel on a computer (« Préparer une commande »): up to 680 px.
    expect(base["container-panel"]).toBe("42.5rem");
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
