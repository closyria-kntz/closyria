"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import { buttonClass } from "./ui";

/**
 * A modal dialog on the native `<dialog>`: the browser traps the focus inside, closes on Escape and gives the focus
 * back to the button that opened it. Clicking the backdrop closes it too.
 */
export function Dialog({
  open,
  onClose,
  title,
  closeLabel,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click on the backdrop is a mouse shortcut; Escape and the close button are the keyboard ways.
    <dialog
      ref={ref}
      aria-modal="true"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => event.target === ref.current && onClose()}
      className="m-auto w-11/12 max-w-narrow rounded-card border border-line bg-surface-raised p-space-5 text-ink shadow-lifted backdrop:bg-ink/40"
    >
      {open && (
        <div className="flex flex-col gap-space-4">
          <div className="flex items-start justify-between gap-space-3">
            <h2 id={titleId} className="font-display text-lead font-strong">
              {title}
            </h2>
            <button type="button" onClick={onClose} className={`${buttonClass} min-h-touch-target`}>
              {closeLabel}
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
