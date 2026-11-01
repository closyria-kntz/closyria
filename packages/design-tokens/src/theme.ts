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

/** Provisional: replaced by the visual-direction task. Complete token set, applied on `:root` too. */
export const atelierLight: Theme & { tokens: SemanticTokens } = {
  id: "atelier-light",
  name: "Atelier clair",
  base: "light",
  tokens: { ...defaultSemanticTokens },
};

/** Provisional dark variant: only the colors differ, the rest is inherited from the light theme. */
export const atelierDark: Theme = {
  id: "atelier-dark",
  name: "Atelier sombre",
  base: "dark",
  tokens: {
    "color-surface": c.night,
    "color-surface-raised": c.graphite,
    "color-surface-sunken": c.charcoal,
    "color-surface-strong": c.coal,
    "color-outline": c.bark,
    "color-ink": c.bone,
    "color-ink-muted": c.stone,
    "color-accent": c.coral,
    "color-accent-ink": c.ink,
    "color-info": c.tealPale,
    "color-danger": c.rose,
    "color-success": c.moss,
    "color-focus-ring": c.tealPale,
  },
};

export const themes = [atelierLight, atelierDark] as const;
export const defaultTheme = atelierLight;
