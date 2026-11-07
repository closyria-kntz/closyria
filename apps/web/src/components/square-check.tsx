"use client";

/**
 * The small square checkbox of « Préparer une commande » (list and preview): a native checkbox, invisible, covering its
 * positioned parent (the touch area), with the drawn box on top letting clicks through. Place it in a `relative` label.
 */
export function SquareCheck({
  id,
  checked,
  onChange,
  labelledBy,
}: {
  /** Id for the surrounding label's `htmlFor`. */
  id: string;
  checked: boolean;
  onChange: () => void;
  /** Id of the text naming it, when the surrounding label does not. */
  labelledBy?: string;
}) {
  return (
    <>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-labelledby={labelledBy}
        className="peer absolute inset-0 size-full cursor-pointer opacity-0"
      />
      <span
        data-testid="order-check"
        className="pointer-events-none flex size-space-5 shrink-0 items-center justify-center rounded-sm border-2 border-ink-muted text-accent-ink peer-checked:border-accent peer-checked:bg-accent"
      >
        {checked && (
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-space-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          >
            <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </>
  );
}
