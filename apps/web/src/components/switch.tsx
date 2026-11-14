import { useId } from "react";
import { focusRing } from "./ui";

/**
 * An on / off setting: the whole row is the switch, its label its name (the list's sharing settings, the
 * notifications, « M'alerter »). `hint` is a line under the label that says what it does.
 */
export function Switch({
  label,
  hint,
  on,
  onToggle,
  disabled = false,
}: {
  label: string;
  hint?: string | undefined;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const hintId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-describedby={hint ? hintId : undefined}
      disabled={disabled}
      onClick={onToggle}
      className={`flex min-h-touch-target w-full items-center justify-between gap-space-3 rounded-button py-space-1 text-left text-sm text-ink disabled:opacity-60 ${focusRing}`}
    >
      <span className="flex min-w-space-0 flex-col gap-space-0-5">
        <span className={hint ? "font-strong" : undefined}>{label}</span>
        {hint && (
          <span id={hintId} className="text-sm text-ink-muted">
            {hint}
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={`relative h-space-5 w-space-7 shrink-0 rounded-full transition-colors duration-fast ${on ? "bg-accent" : "bg-ink-muted"}`}
      >
        <span
          className={`absolute top-space-1 left-space-1 size-space-4 rounded-full transition-transform duration-fast ${on ? "translate-x-space-5 bg-accent-ink" : "bg-surface-raised"}`}
        />
      </span>
    </button>
  );
}
