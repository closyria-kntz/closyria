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
    "color-surface": c.aubergine,
    "color-surface-raised": c.damson,
    "color-surface-sunken": c.dusk,
    "color-surface-strong": c.mulberry,
    "color-line": c.mulberry,
    "color-ink": c.petal,
    "color-ink-muted": c.heather,
    "color-accent": c.orchid,
    "color-accent-ink": c.aubergine,
    "color-success": c.sage,
    "color-success-surface": c.spruce,
    "color-premium": c.gold,
    "color-premium-surface": c.olivewood,
    "color-hint": c.umber,
    "color-media-backdrop": c.dusk,
    "color-danger": c.salmon,
    "color-focus-ring": c.orchid,
  },
};

export const themes = [equilibreLight, equilibreDark] as const;
export const defaultTheme = equilibreLight;
