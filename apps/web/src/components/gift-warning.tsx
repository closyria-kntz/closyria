"use client";

import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { answerGiftWarning, getGiftWarning, subscribeGiftWarning } from "@/lib/gift-check";
import { Dialog } from "./dialog";
import { buttonClass, primaryButtonClass } from "./ui";

const touch = "min-h-touch-target";

/**
 * « Attends un peu 🎁 » (spec § 4), mounted once in the shell: shown by `confirmUnlessReserved` when a friend may
 * have planned to give what she is about to buy. « Attendre » (or closing) does nothing; « Je le prends quand même »
 * / « Commander quand même » goes on. Never says who, nor which of the items.
 */
export function GiftWarning() {
  const t = useTranslations("Gifts.warning");
  const request = useSyncExternalStore(subscribeGiftWarning, getGiftWarning, () => null);
  const answer = (go: boolean) => request && answerGiftWarning(request.id, go);
  return (
    <Dialog open={request !== null} onClose={() => answer(false)} title={t("title")} closeLabel={t("close")}>
      {request && (
        <>
          <p className="text-ink-muted">{request.total > 1 ? t("many", { count: request.count }) : t("one")}</p>
          <div className="flex flex-wrap gap-space-2">
            <button type="button" onClick={() => answer(false)} className={`${primaryButtonClass} ${touch}`}>
              {t("wait")}
            </button>
            <button type="button" onClick={() => answer(true)} className={`${buttonClass} ${touch}`}>
              {t(request.kind === "order" ? "order" : "take")}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
