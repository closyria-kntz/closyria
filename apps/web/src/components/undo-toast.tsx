"use client";

import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { getUndoStack, pushUndo, runUndo, subscribeUndo } from "@/lib/undo";
import { buttonClass } from "./ui";

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
          className="pointer-events-auto flex items-center gap-space-3 rounded-card bg-ink px-space-4 py-space-2 text-sm text-surface-raised shadow-lifted"
        >
          <span>{entry.label}</span>
          {entry.undoable && (
            <>
              <span aria-hidden="true">·</span>
              <button type="button" onClick={() => undo(entry.id)} className={`${buttonClass} min-h-touch-target`}>
                {t("undo")}
              </button>
            </>
          )}
        </p>
      ))}
    </div>
  );
}
