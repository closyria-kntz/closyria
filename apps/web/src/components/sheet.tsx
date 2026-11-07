"use client";

import { type PointerEvent, type ReactNode, useEffect, useRef } from "react";
import { buttonClass } from "./ui";

/** Dragging the top of a sheet down by this much closes it (phone gesture, works with a mouse too). */
export const SHEET_DRAG_CLOSE_PX = 80;

type Props = {
  open: boolean;
  onClose: () => void;
  /** Id of the heading inside `children`, which names the dialog. */
  labelledBy: string;
  closeLabel: string;
  /** Short line beside « Fermer », only visible on a phone (where the sheet can be dragged). */
  hint: string;
  /** Large panel on the right on a computer; otherwise a centered one. A sheet from the bottom on a phone either way. */
  wide?: boolean;
  /** Extra classes for the scrolling body (a grid layout, for instance). */
  bodyClassName?: string;
  children: ReactNode;
  footer?: ReactNode;
};

const PHONE = "m-space-0 mt-auto h-5/6 max-h-full w-full max-w-full rounded-t-card";
const PANEL =
  "md:mt-space-0 md:mr-space-0 md:ml-auto md:h-full md:w-3/5 md:max-w-panel md:rounded-l-card md:rounded-tr-none";
const CENTERED = "md:m-auto md:h-auto md:max-h-5/6 md:w-full md:max-w-panel md:rounded-card";

/**
 * A native dialog shown as a sheet from the bottom on a phone, a right panel (`wide`) or a centered one on a
 * computer. Closes with « Fermer », Escape, a click beside it or a drag down from its top; the caller may also close
 * it from the back button.
 */
export function Sheet({
  open,
  onClose,
  labelledBy,
  closeLabel,
  hint,
  wide = false,
  bodyClassName = "",
  children,
  footer,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  // The drag in progress: where it started and how far down it went; the sheet follows the finger.
  const drag = useRef<{ start: number; offset: number } | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (!open) {
      drag.current = null;
      dialog.style.removeProperty("translate");
    }
  }, [open]);

  function resetDrag() {
    drag.current = null;
    ref.current?.style.removeProperty("translate");
  }
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { start: event.clientY, offset: 0 };
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current.offset = Math.max(0, event.clientY - drag.current.start);
    ref.current?.style.setProperty("translate", `0 ${drag.current.offset}px`);
  };
  const endDrag = () => {
    const far = (drag.current?.offset ?? 0) >= SHEET_DRAG_CLOSE_PX;
    resetDrag();
    if (far) onClose();
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click on the backdrop is a mouse shortcut; Escape and « Fermer » are the keyboard ways.
    <dialog
      ref={ref}
      aria-modal="true"
      aria-labelledby={labelledBy}
      onClose={onClose}
      onClick={(event) => event.target === ref.current && onClose()}
      className={`${PHONE} ${wide ? PANEL : CENTERED} overflow-hidden border open:flex open:flex-col border-line bg-surface-raised p-space-0 text-ink shadow-lifted backdrop:bg-ink/40`}
    >
      {open && (
        // The dialog is a column with a height cap (centered) or a fixed height (sheet, panel): the body scrolls inside
        // it and the footer always stays in view.
        <div className="flex min-h-space-0 flex-1 flex-col">
          <div
            data-testid="preview-handle"
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={resetDrag}
            className="flex touch-none flex-col gap-space-1 border-b border-line px-space-4 pt-space-2 pb-space-2 select-none"
          >
            <span aria-hidden="true" className="mx-auto h-space-1 w-space-7 rounded-full bg-line md:hidden" />
            <div className="flex items-center justify-between gap-space-3">
              <p className="text-sm text-ink-muted md:invisible">{hint}</p>
              <button
                type="button"
                onClick={onClose}
                className={`${buttonClass} min-h-touch-target shrink-0 font-strong`}
              >
                <span aria-hidden="true">×</span>
                {closeLabel}
              </button>
            </div>
          </div>

          <div
            data-testid="preview-body"
            className={`grid min-h-space-0 flex-1 content-start gap-space-4 overflow-y-auto overscroll-contain p-space-4 ${bodyClassName}`}
          >
            {children}
          </div>

          {footer}
        </div>
      )}
    </dialog>
  );
}
