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
  "color-surface": palette.blush,
  "color-surface-raised": palette.porcelain,
  "color-surface-sunken": palette.veil,
  "color-surface-strong": palette.rosewater,
  "color-line": palette.rosewater,
  "color-ink": palette.prune,
  "color-ink-muted": palette.mauve,
  "color-accent": palette.plum,
  "color-accent-ink": palette.ivory,
  "color-success": palette.pine,
  "color-success-surface": palette.mint,
  "color-premium": palette.bronze,
  "color-premium-surface": palette.champagne,
  "color-hint": palette.cream,
  "color-media-backdrop": palette.veil,
  "color-danger": palette.garnet,
  "color-focus-ring": palette.plum,
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
  "radius-button": radius.md,
  "radius-card": radius.lg,
  // Typography
  "font-body": font.body,
  "font-display": font.display,
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
  "breakpoint-xl": breakpoint.xl,
  "container-narrow": container.narrow,
  "container-wide": container.wide,
  "container-app": container.app,
  "container-measure": container.measure,
  "container-sidebar": container.sidebar,
  "container-paste": container.paste,
  "container-panel": container.panel,
  "spacing-touch-target": size.touchTarget,
  "spacing-panel-max": size.panelMax,
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
