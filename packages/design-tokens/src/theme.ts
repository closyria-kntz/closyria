import { z } from "zod";
import { primitives } from "./primitives";
import { defaultSemanticTokens, type SemanticTokens, semanticTokensSchema } from "./semantic";

const assetSchema = z.object({
  id: z.string().min(1),
  url: z.url(),
  placement: z.string().min(1),
  alt: z.string().optional(),
});

/**
 * Reserved for seasonal themes (a later project): illustrations, animations, header images and
 * catchphrases per locale. Validated now, never rendered yet.
 */
export const decorationSetSchema = z.strictObject({
  illustrations: z.array(assetSchema).default([]),
  animations: z.array(assetSchema).default([]),
  headerImages: z.array(assetSchema).default([]),
  catchphrases: z.record(z.string().min(2), z.string().min(1)).default({}),
});
export type DecorationSet = z.infer<typeof decorationSetSchema>;

export const themeSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  base: z.enum(["light", "dark"]),
  tokens: semanticTokensSchema,
  decorations: decorationSetSchema.optional(),
});
export type Theme = z.infer<typeof themeSchema>;

const { palette: c } = primitives;

/** Reference appearance. Complete token set, also applied on `:root`. */
export const equilibreLight: Theme & { tokens: SemanticTokens } = {
  id: "equilibre-light",
  name: "Équilibré clair",
  base: "light",
  tokens: { ...defaultSemanticTokens },
};

/** Dark variant: only the colors differ, the rest is inherited from the light theme. */
export const equilibreDark: Theme = {
  id: "equilibre-dark",
  name: "Équilibré sombre",
  base: "dark",
  tokens: {
    "color-surface": c.plum,
    "color-surface-raised": c.plumRaised,
    "color-surface-sunken": c.plumSunken,
    "color-surface-strong": c.plumStrong,
    "color-line": c.plumHint,
    "color-ink": c.inkLight,
    "color-ink-muted": c.mutedLight,
    "color-accent": c.raspberryLight,
    "color-accent-ink": c.plum,
    "color-success": c.celadon,
    "color-success-surface": c.spruce,
    "color-premium": c.gold,
    "color-premium-surface": c.olivewood,
    "color-hint": c.plumHint,
    "color-media-backdrop": c.plumSunken,
    "color-danger": c.salmon,
    "color-success-soft": c.spruce,
    "color-success-edge": c.fern,
    "color-danger-soft": c.wine,
    "color-danger-edge": c.oldRose,
    "color-focus-ring": c.raspberryLight,
    "color-band": c.plumRaised,
    "color-band-line": c.plumHint,
    // The mockup's dark clay: light ink on the plum page, like every dark-mode button.
    "color-band-button": c.inkLight,
    "color-band-button-ink": c.plum,
    "color-band-button-hover": c.mutedLight,
    "color-selected-surface": c.plumHint,
    "color-selected-line": c.mutedPlum,
    "color-button-bg": c.inkLight,
    "color-button-ink": c.plum,
    "color-detail": c.champagne,
    "color-glass": "color-mix(in srgb, var(--color-surface-raised) 62%, transparent)",
    "color-glass-line": `color-mix(in srgb, ${c.white} 7%, transparent)`,
    "color-aurora-1": `color-mix(in srgb, ${c.raspberryLight} 18%, transparent)`,
    "color-aurora-2": `color-mix(in srgb, ${c.champagne} 12%, transparent)`,
    "color-aurora-3": `color-mix(in srgb, ${c.lavenderMist} 12%, transparent)`,
    "color-toast-action": "color-mix(in srgb, var(--color-button-ink) 16%, transparent)",
    "shadow-block": "0 10px 30px rgb(0 0 0 / 0.4)",
  },
};

export const themes = [equilibreLight, equilibreDark] as const;
export const defaultTheme = equilibreLight;
