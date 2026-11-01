import { z } from "zod";
import { primitives as p } from "./primitives";

const { palette, space, radius, font, fontSize, fontWeight, duration, easing, shadow, breakpoint, container } = p;

/**
 * Layer 2 (semantic) and layer 3 (component) tokens. Keys are the CSS variable names without `--`;
 * the prefix is the Tailwind namespace, so `color-surface` yields `bg-surface`, `text-surface`, ...
 * The UI only ever uses these.
 */
export const defaultSemanticTokens = {
  // Colors (theme-dependent)
  "color-surface": palette.cream,
  "color-surface-raised": palette.paper,
  "color-surface-sunken": palette.sand,
  "color-surface-strong": palette.linen,
  "color-outline": palette.blush,
  "color-ink": palette.ink,
  "color-ink-muted": palette.umber,
  "color-accent": palette.rust,
  "color-accent-ink": palette.paper,
  "color-info": palette.teal,
  "color-danger": palette.crimson,
  "color-success": palette.olive,
  "color-focus-ring": palette.teal,
  // Component tokens
  "color-button-bg": "var(--color-accent)",
  "color-button-ink": "var(--color-accent-ink)",
  "color-card-bg": "var(--color-surface-raised)",
  "color-card-border": "var(--color-outline)",
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
  "text-base": fontSize.base,
  "text-lead": fontSize.lead,
  "text-title": fontSize.title,
  "text-display": fontSize.display,
  "font-weight-regular": fontWeight.regular,
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
