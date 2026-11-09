"use client";

import type { WishlistView } from "@closyria/shared";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { answerGiftReminder } from "@/lib/wardrobe-client";
import { buttonClass, primaryButtonClass } from "./ui";

const touch = "min-h-touch-target";

/** « mon anniversaire » → « Mon anniversaire »: the occasion opens the sentence. */
export function sentenceCase(text: string): string {
  const [first = "", ...rest] = [...text];
  return first.toLocaleUpperCase("fr") + rest.join("");
}

/** `YYYY-MM-DD` as « 12 mars » (the day itself, whatever her time zone). */
export function occasionDay(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/**
 * The day after her occasion (spec § 4): « {occasion} est passé : tu as reçu des cadeaux de ta liste « {liste} » ? »,
 * on « Mes envies » (with « Ouvrir la liste ») and on the list. « Plus tard » hides it 7 days, « C'est fait » for this
 * occasion. It says nothing of what her friends reserved.
 */
export function GiftReminder({
  list,
  linked,
  onAnswered,
}: {
  list: WishlistView;
  /** « Ouvrir la liste » (not on the list's own page). */
  linked: boolean;
  /** Hidden: the page drops it. */
  onAnswered: (list: WishlistView) => void;
}) {
  const t = useTranslations("Gifts.reminder");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const text = list.giftOccasion
    ? t("occasion", { occasion: sentenceCase(list.giftOccasion), list: list.name })
    : t("date", { date: occasionDay(list.giftDate ?? "", locale), list: list.name });

  async function answer(action: "snooze" | "dismiss") {
    setBusy(true);
    setFailed(false);
    const result = await answerGiftReminder(list.id, action);
    setBusy(false);
    if (!result.ok) return setFailed(true);
    onAnswered({ ...list, giftReminderDue: false });
  }

  return (
    <section
      aria-label={t("label")}
      className="flex flex-col gap-space-3 rounded-card border border-line bg-hint px-space-4 py-space-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
    >
      <p className="max-w-measure text-sm text-ink">
        <span aria-hidden="true">🎁 </span>
        {text}
      </p>
      <div className="flex flex-wrap gap-space-2">
        {linked && (
          <Link href={`/listes/${list.id}`} className={`${primaryButtonClass} ${touch}`}>
            {t("open")}
          </Link>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void answer("dismiss")}
          className={`${linked ? buttonClass : primaryButtonClass} ${touch}`}
        >
          {t("done")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void answer("snooze")}
          className={`${buttonClass} ${touch}`}
        >
          {t("later")}
        </button>
      </div>
      {failed && (
        <p role="alert" className="w-full text-sm text-danger">
          {t("failed")}
        </p>
      )}
    </section>
  );
}
