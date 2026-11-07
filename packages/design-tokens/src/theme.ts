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
    "color-surface": c.espresso,
    "color-surface-raised": c.mocha,
    "color-surface-sunken": c.bark,
    "color-surface-strong": c.umber,
    "color-line": c.umber,
    // Softened like the light theme: a warm parchment, no longer near-white.
    "color-ink": c.parchment,
    "color-ink-muted": c.stone,
    "color-accent": c.powder,
    "color-accent-ink": c.cocoa,
    "color-success": c.celadon,
    "color-success-surface": c.spruce,
    "color-premium": c.gold,
    "color-premium-surface": c.olivewood,
    "color-hint": c.umber,
    "color-media-backdrop": c.bark,
    "color-danger": c.salmon,
    "color-success-soft": c.spruce,
    "color-success-edge": c.fern,
    "color-danger-soft": c.wine,
    "color-danger-edge": c.oldRose,
    "color-focus-ring": c.powder,
    "color-band": c.mocha,
    "color-band-line": c.dustyRose,
    "color-band-button": c.powder,
    "color-band-button-ink": c.cocoa,
    "color-band-button-hover": c.blush,
  },
};

export const themes = [equilibreLight, equilibreDark] as const;
export const defaultTheme = equilibreLight;
