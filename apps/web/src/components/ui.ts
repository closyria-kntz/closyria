/** Shared class lists (admin area, sign-in page): tokens only, so the visual direction can change underneath. */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline-solid";

export const buttonClass = `inline-flex items-center gap-space-2 rounded-button border border-line bg-surface-raised px-space-3 py-space-2 text-sm text-ink hover:bg-surface-strong ${focusRing}`;

export const primaryButtonClass = `inline-flex items-center justify-center gap-space-2 rounded-button bg-button-bg px-space-4 py-space-2 text-sm font-strong text-button-ink disabled:opacity-60 ${focusRing}`;

export const inputClass = `w-full rounded-button border border-line bg-surface-raised px-space-3 py-space-2 text-control text-ink ${focusRing}`;

/** A pill that stays pressed (« Prioritaire »): accent border and a soft fill when on. */
export const toggleButtonClass = `${buttonClass} min-h-touch-target aria-pressed:border-accent aria-pressed:bg-hint aria-pressed:font-strong`;

/** A big level button: her emoji over her name, pressed when chosen (the picker, the shared link). */
export const levelButtonClass = `flex min-h-level-tile-sm flex-col items-center justify-center gap-space-1 rounded-card border border-line bg-surface-raised px-space-1 py-space-2-5 text-caption text-ink sm:min-h-level-tile transition-colors duration-base hover:bg-surface-strong disabled:opacity-60 aria-pressed:border-accent aria-pressed:bg-hint aria-pressed:font-strong ${focusRing}`;

/** A block of the product sheet (« l’article », « Ton envie », « Tailles »…): a frosted glass card (mockup .block). */
export const blockClass =
  "glass flex min-w-space-0 flex-col gap-space-3 rounded-block p-space-4-5 shadow-block sm:px-space-6-5 sm:py-space-5-5";

/** The title of a block of the sheet (mockup .block h2: Fraunces 20 px, medium). */
export const blockTitleClass = "font-display text-heading font-medium";
