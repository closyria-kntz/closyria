"use client";

import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { getUndoStack, pushUndo, runUndo, subscribeUndo } from "@/lib/undo";
import { focusRing } from "./ui";

/** « Annuler » in a toast: a veil of the toast's own ink, 34 px (36 above a phone), a finger wide all the same. */
const actionClass = `hit-area relative h-control-2xs rounded-button bg-toast-action px-space-3-5 font-strong text-button-ink sm:h-control-xs ${focusRing}`;

const EMPTY: ReturnType<typeof getUndoStack> = [];

/**
 * The toast of the last action: « message · Annuler » for 8 s (Annuler only when the API gave an undo).
 * The live region is always mounted so a screen reader announces each new message.
 */
export function UndoToast() {
  const t = useTranslations("Item.toast");
  const stack = useSyncExternalStore(subscribeUndo, getUndoStack, () => EMPTY);

  async function undo(id: number) {
    const ok = await runUndo(id);
    pushUndo(ok ? t("undone") : t("failed"), null);
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="false"
      aria-relevant="additions"
      aria-label={t("label")}
      data-undo-toast=""
      className="pointer-events-none fixed inset-x-space-4 bottom-space-8 z-40 grid justify-items-center md:bottom-space-5"
    >
      {stack.map((entry, index) => (
        <p
          key={entry.id}
          data-toast-rank={stack.length - 1 - index}
          className="pointer-events-auto flex items-center gap-space-3 rounded-toast bg-button-bg py-space-2 pr-space-2 pl-space-4 text-sm text-button-ink shadow-block sm:py-space-3 sm:pr-space-3 sm:pl-space-4-5 sm:text-control"
        >
          <span>{entry.label}</span>
          {entry.undoable && (
            <>
              <span aria-hidden="true">·</span>
              <button type="button" onClick={() => undo(entry.id)} className={actionClass}>
                {t("undo")}
              </button>
            </>
          )}
        </p>
      ))}
    </div>
  );
}
