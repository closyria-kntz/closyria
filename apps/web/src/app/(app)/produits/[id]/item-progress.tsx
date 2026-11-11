"use client";

import type { ItemView } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { LINE, lineOf } from "./item-line";

/** The line itself (mockup .steps): each step over a 3 px rule, the current one in ink over the accent. */
export function ItemProgress({ item }: { item: Pick<ItemView, "stage" | "received"> }) {
  const t = useTranslations("Item");
  const tStep = useTranslations("Views.step");
  const { current, status } = lineOf(item);
  return (
    <div className="flex items-center gap-space-2">
      <ol aria-label={t("progress.label")} className="flex min-w-space-0 flex-1 items-stretch">
        {LINE.map((step) => {
          const on = step === current;
          return (
            <li
              key={step}
              aria-current={on ? "step" : undefined}
              className={`flex flex-1 items-center justify-center border-b-3 px-space-0-5 py-space-2 text-center text-meta leading-tight font-bold ${on ? "border-selected-line text-ink" : "border-line text-ink-muted"}`}
            >
              {tStep(step)}
              {on && <span className="sr-only"> ({t("progress.current")})</span>}
            </li>
          );
        })}
      </ol>
      {status && (
        <span
          data-testid="stage-status"
          className="shrink-0 rounded-pill bg-label px-space-2 py-space-0-75 text-tag font-bold text-label-ink"
        >
          {t(`stage.${status}`)}
        </span>
      )}
    </div>
  );
}
