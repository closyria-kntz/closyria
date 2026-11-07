/** Shared class lists (admin area, sign-in page): tokens only, so the visual direction can change underneath. */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline-solid";

export const buttonClass = `inline-flex items-center gap-space-2 rounded-button border border-line bg-surface-raised px-space-3 py-space-2 text-sm text-ink hover:bg-surface-strong ${focusRing}`;

export const primaryButtonClass = `inline-flex items-center justify-center gap-space-2 rounded-button bg-button-bg px-space-4 py-space-2 text-sm font-strong text-button-ink disabled:opacity-60 ${focusRing}`;

export const inputClass = `w-full rounded-button border border-line bg-surface-raised px-space-3 py-space-2 text-body text-ink ${focusRing}`;

/** A pill that stays pressed (« Prioritaire »): accent border and a soft fill when on. */
export const toggleButtonClass = `${buttonClass} min-h-touch-target aria-pressed:border-accent aria-pressed:bg-hint aria-pressed:font-strong`;
