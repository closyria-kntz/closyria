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

/**
 * Reference appearance: Boudoir light (docs/specs/2026-11-11-refonte-boudoir.md, section 4). Complete token set, also
 * applied on `:root`. Her saved appearance (« Clair », « Sombre », « Automatique ») points at the Boudoir themes.
 */
export const boudoirLight: Theme & { tokens: SemanticTokens } = {
  id: "boudoir-light",
  name: "Boudoir clair",
  base: "light",
  tokens: { ...defaultSemanticTokens },
};

/** Boudoir dark (validated on 2026-11-11): only the colors differ, the rest is inherited from the light theme. */
export const boudoirDark: Theme = {
  id: "boudoir-dark",
  name: "Boudoir sombre",
  base: "dark",
  tokens: {
    "color-surface": c.nightBurgundy,
    "color-surface-raised": c.nightCard,
    "color-surface-sunken": c.nightSoft,
    "color-surface-strong": c.nightSoft,
    "color-line": c.nightLine,
    "color-ink": c.nightInk,
    "color-ink-muted": c.nightMuted,
    // The main buttons turn powder pink with burgundy ink; text links and focus take the lighter rose.
    "color-accent": c.powderRose,
    "color-accent-ink": c.boudoirInk,
    "color-success": c.celadon,
    "color-success-surface": c.spruce,
    "color-premium": c.gold,
    "color-premium-surface": c.olivewood,
    "color-hint": c.nightUne,
    "color-media-backdrop": c.nightSoft,
    "color-danger": c.salmon,
    "color-success-soft": c.spruce,
    "color-success-edge": c.fern,
    "color-danger-soft": c.wine,
    "color-danger-edge": c.oldRose,
    "color-focus-ring": c.nightRose,
    "color-band": c.nightBand,
    "color-band-ink": c.nightInk,
    "color-band-button": c.powderRose,
    "color-band-button-ink": c.boudoirInk,
    "color-band-button-hover": c.nightMuted,
    "color-selected-surface": c.nightUne,
    "color-selected-line": c.nightRose,
    "color-label": c.ochre,
    "color-label-ink": c.boudoirInk,
    "color-une": c.nightUne,
    "color-tip": c.nightTip,
    "color-tip-ink": c.nightTipInk,
    "color-button-bg": c.powderRose,
    "color-button-ink": c.boudoirInk,
    "color-detail": c.ochre,
    "color-glass": "color-mix(in srgb, var(--color-surface-raised) 62%, transparent)",
    "color-glass-line": `color-mix(in srgb, ${c.white} 7%, transparent)`,
    "color-toast-action": "color-mix(in srgb, var(--color-button-ink) 16%, transparent)",
    "shadow-block": "0 10px 30px rgb(0 0 0 / 0.4)",
  },
};

export const themes = [boudoirLight, boudoirDark] as const;
export const defaultTheme = boudoirLight;
