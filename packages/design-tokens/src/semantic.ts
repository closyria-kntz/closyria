import { z } from "zod";
import { primitives as p } from "./primitives";

const { palette, space, radius, font, fontSize, fontWeight, duration, easing, shadow, breakpoint, container, size } = p;

/**
 * Layer 2 (semantic) and layer 3 (component) tokens. Keys are the CSS variable names without `--`;
 * the prefix is the Tailwind namespace, so `color-surface` yields `bg-surface`, `text-surface`, ...
 * The UI only ever uses these.
 */
export const defaultSemanticTokens = {
  // Colors (theme-dependent). Names follow the visual-direction spec, section 3.1.
  "color-surface": palette.blushLavender,
  "color-surface-raised": palette.white,
  "color-surface-sunken": palette.lilacSunken,
  "color-surface-strong": palette.lilacStrong,
  "color-line": palette.lilacStrong,
  // Softened on 2026-11-07 (« le contraste en clair trop prononcé »): a dark chocolate, no longer near-black.
  "color-ink": palette.inkPlum,
  "color-ink-muted": palette.mutedPlum,
  "color-accent": palette.raspberry,
  "color-accent-ink": palette.white,
  "color-success": palette.pine,
  "color-success-surface": palette.sage,
  "color-premium": palette.bronze,
  "color-premium-surface": palette.butter,
  "color-hint": palette.pinkMist,
  "color-media-backdrop": palette.lilacSunken,
  "color-danger": palette.garnet,
  // Budget pills in the order band (version B chosen on 2026-11-07): soft fill, edge, same for green and red.
  "color-success-soft": palette.mint,
  "color-success-edge": palette.leaf,
  "color-danger-soft": palette.rosePetal,
  "color-danger-edge": palette.coral,
  "color-focus-ring": palette.raspberry,
  // « Préparer une commande » band: white with a pink edge (chosen on 2026-11-07, after version B in pink).
  "color-band": palette.white,
  "color-band-line": palette.pinkMist,
  "color-band-button": palette.bordeaux,
  "color-band-button-ink": palette.white,
  "color-band-button-hover": palette.inkPlum,
  // A ticked row in « Préparer une commande »: a very light pink with the band's pink edge.
  "color-selected-surface": palette.pinkMist,
  "color-selected-line": palette.raspberry,
  // Component tokens
  "color-button-bg": palette.bordeaux,
  "color-button-ink": palette.blushLavender,
  "color-detail": palette.champagne,
  "color-glass": "color-mix(in srgb, var(--color-surface-raised) 62%, transparent)",
  "color-glass-line": "color-mix(in srgb, var(--color-surface-raised) 75%, transparent)",
  "color-aurora-1": "color-mix(in srgb, var(--color-accent) 18%, var(--color-surface))",
  "color-aurora-2": "color-mix(in srgb, var(--color-detail) 28%, var(--color-surface))",
  "color-aurora-3": `color-mix(in srgb, ${palette.lavender} 30%, var(--color-surface))`,
  "color-card-bg": "var(--color-surface-raised)",
  "color-card-border": "var(--color-line)",
  // Spacing
  "spacing-space-0": space[0],
  "spacing-space-1": space[1],
  "spacing-space-2": space[2],
  "spacing-space-3": space[3],
  "spacing-space-4": space[4],
  "spacing-space-5": space[5],
  "spacing-space-6": space[6],
  "spacing-space-7": space[7],
  "spacing-space-8": space[8],
  // Radii
  "radius-none": radius.none,
  "radius-sm": radius.sm,
  "radius-md": radius.md,
  "radius-lg": radius.lg,
  "radius-full": radius.full,
  "radius-button": radius.full,
  "radius-card": radius.lg,
  // Typography
  "font-body": font.body,
  "font-display": font.display,
  "text-caption": fontSize.caption,
  "text-sm": fontSize.sm,
  "text-body": fontSize.body,
  "text-lead": fontSize.lead,
  "text-title": fontSize.title,
  "text-display": fontSize.display,
  "font-weight-regular": fontWeight.regular,
  "font-weight-medium": fontWeight.medium,
  "font-weight-strong": fontWeight.strong,
  // Motion
  "motion-duration-instant": duration.instant,
  "motion-duration-fast": duration.fast,
  "motion-duration-base": duration.base,
  "motion-duration-slow": duration.slow,
  "ease-standard": easing.standard,
  "ease-emphasized": easing.emphasized,
  // Elevation
  "shadow-soft": shadow.soft,
  "shadow-lifted": shadow.lifted,
  // Layout
  "breakpoint-sm": breakpoint.sm,
  "breakpoint-md": breakpoint.md,
  "breakpoint-lg": breakpoint.lg,
  "container-narrow": container.narrow,
  "container-wide": container.wide,
  "container-app": container.app,
  "container-measure": container.measure,
  "container-sidebar": container.sidebar,
  "container-panel": container.panel,
  "spacing-touch-target": size.touchTarget,
} as const;

export type SemanticTokenKey = keyof typeof defaultSemanticTokens;
export type SemanticTokens = Record<SemanticTokenKey, string>;

export const semanticTokenKeys = Object.keys(defaultSemanticTokens) as SemanticTokenKey[];

/** Durations forced to 0ms under `prefers-reduced-motion`. */
export const motionDurationKeys = semanticTokenKeys.filter((key) => key.startsWith("motion-duration-"));

/** Strict: an unknown key is an error, every known key is optional. */
export const semanticTokensSchema = z.strictObject(
  Object.fromEntries(semanticTokenKeys.map((key) => [key, z.string().min(1).optional()])) as Record<
    SemanticTokenKey,
    z.ZodOptional<z.ZodString>
  >,
);
