import { z } from "zod";
import { primitives as p } from "./primitives";

const { palette, space, radius, font, fontSize, fontWeight, duration, easing, shadow, breakpoint, container, size } = p;

/**
 * Layer 2 (semantic) and layer 3 (component) tokens. Keys are the CSS variable names without `--`;
 * the prefix is the Tailwind namespace, so `color-surface` yields `bg-surface`, `text-surface`, ...
 * The UI only ever uses these.
 */
export const defaultSemanticTokens = {
  // Colors (theme-dependent): Boudoir light (docs/specs/2026-11-11-refonte-boudoir.md, section 4). Page, cards, the
  // soft and chip fills, rosy lines, burgundy ink, mauve-grey secondary text, burgundy accent (bands, main buttons).
  "color-surface": palette.cream,
  "color-surface-raised": palette.white,
  "color-surface-sunken": palette.softRose,
  "color-surface-strong": palette.chipRose,
  "color-line": palette.rosyLine,
  "color-ink": palette.boudoirInk,
  "color-ink-muted": palette.mauveGrey,
  "color-accent": palette.burgundy,
  "color-accent-ink": palette.white,
  "color-success": palette.pine,
  "color-success-surface": palette.sage,
  "color-premium": palette.bronze,
  "color-premium-surface": palette.butter,
  "color-hint": palette.powderRose,
  "color-media-backdrop": palette.softRose,
  "color-danger": palette.garnet,
  // Budget pills in the order band (version B chosen on 2026-11-07): soft fill, edge, same for green and red.
  "color-success-soft": palette.mint,
  "color-success-edge": palette.leaf,
  "color-danger-soft": palette.rosePetal,
  "color-danger-edge": palette.coral,
  "color-focus-ring": palette.burgundyAccent,
  // The burgundy header band of Boudoir and its ink.
  "color-band": palette.burgundy,
  "color-band-ink": palette.white,
  // The menu in the band (mockup .hdr): the current place as a powder-pink pill, the search field a light veil.
  "color-band-tab-on": palette.powderRose,
  "color-band-tab-on-ink": palette.burgundy,
  "color-band-field": `color-mix(in srgb, ${palette.white} 14%, transparent)`,
  "color-band-field-ink": palette.powderRose,
  // Her initial in the band (mockup .avatar) and the phone's bottom bar (mockup .bnav).
  "color-avatar-ink": palette.burgundyAccent,
  "color-nav": palette.white,
  // The main button of « Préparer une commande » and of the item preview.
  "color-band-button": palette.burgundy,
  "color-band-button-ink": palette.white,
  "color-band-button-hover": palette.boudoirInk,
  // A ticked row in « Préparer une commande »: powder pink with a burgundy edge.
  "color-selected-surface": palette.powderRose,
  "color-selected-line": palette.burgundyAccent,
  // Boudoir signature: ochre clothing labels, powder-pink « unes », amber tips.
  "color-label": palette.ochre,
  "color-label-ink": palette.boudoirInk,
  "color-une": palette.powderRose,
  "color-tip": palette.tipCream,
  "color-tip-ink": palette.tipBrown,
  // Component tokens
  "color-button-bg": palette.burgundy,
  "color-button-ink": palette.white,
  "color-detail": palette.ochre,
  // Frosted glass: the raised surface, see-through, with a white edge.
  "color-glass": "color-mix(in srgb, var(--color-surface-raised) 60%, transparent)",
  "color-glass-line": `color-mix(in srgb, ${palette.white} 75%, transparent)`,
  // The « Annuler » of a toast: a light veil of the toast's own text colour.
  "color-toast-action": "color-mix(in srgb, var(--color-button-ink) 16%, transparent)",
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
  // Half steps of the mockup (6, 10, 14, 18, 22, 26 px).
  "spacing-space-1-5": "0.375rem",
  "spacing-space-2-5": "0.625rem",
  "spacing-space-3-5": "0.875rem",
  "spacing-space-4-5": "1.125rem",
  "spacing-space-5-5": "1.375rem",
  "spacing-space-6-5": "1.625rem",
  // Grid of cards: 34 px between rows, 26 px between columns (mockup).
  "spacing-grid-row": "2.125rem",
  "spacing-grid-col": "1.625rem",
  // Visible heights of the controls (mockup): the hit area stays at least the touch target (`hit-area` utility).
  "spacing-control-2xs": "2.125rem",
  "spacing-control-xs": "2.25rem",
  "spacing-control-sm": "2.375rem",
  "spacing-control-md": "2.5rem",
  "spacing-control-lg": "2.625rem",
  "spacing-control-plus": "2.875rem",
  "spacing-control-xl": "3.125rem",
  "spacing-control-2xl": "3.375rem",
  // A size of the sheet (58 × 48 px) and a level tile (66 px, 58 px on a phone).
  "spacing-size-chip": "3.625rem",
  "spacing-level-tile": "4.125rem",
  "spacing-level-tile-sm": "3.625rem",
  // How far the invisible hit area reaches out of a control smaller than the touch target (none if it is larger).
  "spacing-hit-inset": "min(0px, (100% - var(--spacing-touch-target)) / 2)",
  // Undo toast stack: each older message sits one step higher and one step smaller than the next.
  "spacing-toast-stack": "0.75rem",
  // The shell: a phone tab icon (20 px), the raised + (52 px).
  "spacing-nav-icon": "1.25rem",
  "spacing-plus": "3.25rem",
  "scale-toast-stack": "0.05",
  // Radii
  "radius-none": radius.none,
  "radius-sm": radius.sm,
  "radius-md": radius.md,
  "radius-lg": radius.lg,
  "radius-full": radius.full,
  "radius-button": radius.full,
  // Boudoir: cards 20 px, pills and buttons fully round.
  "radius-card": radius.card,
  "radius-pill": radius.pill,
  // Mockup radii: blocks of the sheet 30, « Ma commande » 28, budget card 22, toast 20, sizes 16, « taken » mark 11 px.
  "radius-block": "1.875rem",
  "radius-band": "1.75rem",
  "radius-panel": "1.375rem",
  "radius-toast": "1.25rem",
  "radius-size": "1rem",
  "radius-mark": "0.6875rem",
  // Shape C of the item photos: a rectangle whose top corners are much rounder than the bottom ones.
  "radius-photo-top": radius.photoTop,
  "radius-photo-bottom": radius.photoBottom,
  // The same shape, smaller, for the thumbnails (sheet gallery, preview strip, flight to « Ma commande »).
  "radius-thumb-top": radius.thumbTop,
  "radius-thumb-bottom": radius.thumbBottom,
  // Typography
  // Boudoir: Figtree for the text, Gloock for titles and item names (`font-display` kept as its alias for now).
  "font-body": font.body,
  "font-title": font.title,
  "font-display": font.title,
  "text-caption": fontSize.caption,
  "text-sm": fontSize.sm,
  "text-body": fontSize.body,
  "text-lead": fontSize.lead,
  "text-title": fontSize.title,
  "text-display": fontSize.display,
  // Mockup sizes (fluid ones run from their minimum at 20rem to their maximum at 64rem, like the others).
  "text-ui": "0.9375rem",
  "text-control": "1rem",
  "text-quote": "1.125rem",
  "text-heading": "1.25rem",
  // The shell (mockup .logo 25 px, .links 13.5 px, .bnav 10.5 px, .plus 28 px).
  "text-logo": "1.5625rem",
  "text-menu": "0.84375rem",
  "text-tab": "0.65625rem",
  "text-plus": "1.75rem",
  "text-card-title": "clamp(1.0625rem, 0.9489rem + 0.5682vw, 1.3125rem)",
  "text-sheet-title": "clamp(2rem, 1.6023rem + 1.9886vw, 2.875rem)",
  "text-hero": "clamp(2.25rem, 1.3409rem + 4.5455vw, 4.25rem)",
  "text-emoji-card": "clamp(1.5rem, 1.3295rem + 0.8523vw, 1.875rem)",
  "text-emoji-sheet": "2.25rem",
  "text-emoji-level": "1.375rem",
  "tracking-display": "-0.02em",
  "font-weight-regular": fontWeight.regular,
  "font-weight-medium": fontWeight.medium,
  "font-weight-strong": fontWeight.strong,
  "font-weight-bold": "700",
  // Motion
  "motion-duration-instant": duration.instant,
  "motion-duration-fast": duration.fast,
  "motion-duration-base": duration.base,
  "motion-duration-slow": duration.slow,
  // An item flies to « Ma commande »; the cards of the grid arrive one after the other (both zeroed under reduced motion).
  "motion-duration-fly": "700ms",
  "motion-duration-stagger": "50ms",
  "ease-standard": easing.standard,
  "ease-emphasized": easing.emphasized,
  // Elevation
  "shadow-soft": shadow.soft,
  "shadow-lifted": shadow.lifted,
  // Blocks of the sheet and « Ma commande » (mockup --shadow).
  "shadow-block": "0 10px 30px rgb(43 20 24 / 0.12)",
  // The raised + of the phone's bottom bar (mockup .plus).
  "shadow-plus": "0 6px 16px rgb(0 0 0 / 0.18)",
  // Frosted glass (theme-independent)
  "blur-glass": "20px",
  "saturate-glass": "1.2",
  // The level emoji laid alone on a photo: its soft shadow follows the glyph (a drop-shadow, not a box), and the
  // sparks of the highest level fly this far.
  "drop-shadow-emoji": "0 0.1875rem 0.3125rem color-mix(in srgb, var(--color-ink) 28%, transparent)",
  "spark-reach": "2.25rem",
  "spark-step": "60deg",
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
  // « Ma commande » (640 px) and the big photo of the sheet (480 px).
  "container-band": "40rem",
  "container-photo": "30rem",
  // The search field of the band (mockup .srch, 260 px at least).
  "container-search": "16.25rem",
  "container-budget": "32.5rem",
  // Level tiles (at least 92 px each) and the blocks side by side on the sheet (at least 250 px each).
  "grid-levels": "repeat(auto-fit, minmax(5.75rem, 1fr))",
  "grid-blocks": "repeat(auto-fit, minmax(15.625rem, 1fr))",
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
