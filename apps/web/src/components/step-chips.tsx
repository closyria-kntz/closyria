"use client";

import type { ItemCounts } from "@closyria/shared";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { articlesHref, STEPS } from "@/lib/articles-address";
import type { Step } from "@/lib/wardrobe-view";
import { focusRing } from "./ui";

/** The count of each step in the API's answer. */
const COUNT_OF: Record<Step, keyof ItemCounts> = {
  envie: "envie",
  commande: "commande",
  recu: "recu",
  dressing: "dressing",
  "a-vendre": "aVendre",
};

/** Everything « Tout » shows: the five steps. */
export const totalOf = (counts: ItemCounts): number =>
  counts.envie + counts.commande + counts.recu + counts.dressing + counts.aVendre;

/** How many items a step holds (null: « Tout »). */
export const countOf = (counts: ItemCounts, step: Step | null): number =>
  step ? counts[COUNT_OF[step]] : totalOf(counts);

/**
 * The step chips of « Mes articles » (mockup .chips): « Tout · 62 », « Envies · 6 »…, the current one in ink. Links:
 * the step lives in the address, with the profile and the filters she chose. A finger wide (`hit-area`).
 */
export function StepChips({ current, counts }: { current: Step | null; counts: ItemCounts | null }) {
  const t = useTranslations("Views.chips");
  const search = useSearchParams();
  const params = new URLSearchParams(search.toString());
  const chip = (step: Step | null) => {
    const label = t(step ?? "tout");
    return (
      <li key={step ?? "tout"} className="flex">
        <Link
          href={articlesHref(params, step)}
          scroll={false}
          aria-current={step === current ? "page" : undefined}
          className={`hit-area relative inline-flex items-center rounded-pill bg-surface-strong px-space-3 py-space-2 text-chip font-strong whitespace-nowrap text-ink tabular-nums aria-[current=page]:bg-ink aria-[current=page]:text-surface ${focusRing}`}
        >
          {counts ? t("count", { label, count: countOf(counts, step) }) : label}
        </Link>
      </li>
    );
  };
  return (
    <nav aria-label={t("label")}>
      <ul className="flex flex-wrap gap-x-space-2 gap-y-space-2-5">{[chip(null), ...STEPS.map(chip)]}</ul>
    </nav>
  );
}
