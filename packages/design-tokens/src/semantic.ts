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
  "color-surface": palette.oat,
  "color-surface-raised": palette.white,
  "color-surface-sunken": palette.linen,
  "color-surface-strong": palette.sand,
  "color-line": palette.sand,
  // Softened on 2026-11-07 (« le contraste en clair trop prononcé »): a dark chocolate, no longer near-black.
  "color-ink": palette.ganache,
  "color-ink-muted": palette.taupe,
  "color-accent": palette.chocolate,
  "color-accent-ink": palette.white,
  "color-success": palette.pine,
  "color-success-surface": palette.sage,
  "color-premium": palette.bronze,
  "color-premium-surface": palette.butter,
  "color-hint": palette.powder,
  "color-media-backdrop": palette.latte,
  "color-danger": palette.garnet,
  // Budget pills in the order band (version B chosen on 2026-11-07): soft fill, edge, same for green and red.
  "color-success-soft": palette.mint,
  "color-success-edge": palette.leaf,
  "color-danger-soft": palette.rosePetal,
  "color-danger-edge": palette.coral,
  "color-focus-ring": palette.chocolate,
  // « Préparer une commande » band: white with a pink edge (chosen on 2026-11-07, after version B in pink).
  "color-band": palette.white,
  "color-band-line": palette.rosewood,
  "color-band-button": palette.milkChocolate,
  "color-band-button-ink": palette.white,
  "color-band-button-hover": palette.chocolate,
  // Component tokens
  "color-button-bg": "var(--color-accent)",
  "color-button-ink": "var(--color-accent-ink)",
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
