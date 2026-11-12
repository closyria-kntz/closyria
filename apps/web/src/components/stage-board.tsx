"use client";

import type { ItemCounts, ItemView } from "@closyria/shared";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { articlesHref } from "@/lib/articles-address";
import { fetchItemsPage } from "@/lib/wardrobe-client";
import { type Step, toItemQuery, type ViewFilters, type ViewKey } from "@/lib/wardrobe-view";
import { countOf } from "./step-chips";
import { buttonClass, focusRing } from "./ui";

/** The four columns of « Par étape » (« À vendre » stays a chip): Envies · Commandés · Reçus · Dans mon dressing. */
const COLUMNS: readonly { step: Step; view: ViewKey }[] = [
  { step: "envie", view: "envies" },
  { step: "commande", view: "commande" },
  { step: "recu", view: "recu" },
  { step: "dressing", view: "dressing" },
];

type Column = { status: "loading" | "ready" | "error"; items: ItemView[]; more: boolean };

/**
 * « Par étape » (computer only): her items in four columns side by side, the first page of each step with her filters,
 * each row a link to the sheet; « Tout voir » opens the step.
 */
export function StageBoard({
  filters,
  profileId,
  counts,
  reloadKey,
}: {
  filters: ViewFilters;
  profileId: string | null;
  counts: ItemCounts | null;
  reloadKey: number;
}) {
  const t = useTranslations("Views");
  const search = useSearchParams();
  const [columns, setColumns] = useState<Partial<Record<Step, Column>>>({});
  const filtersKey = JSON.stringify(filters);

  // biome-ignore lint/correctness/useExhaustiveDependencies: filtersKey stands for filters; reloadKey reads again.
  useEffect(() => {
    const controller = new AbortController();
    for (const { step, view } of COLUMNS) {
      setColumns((previous) => ({ ...previous, [step]: { status: "loading", items: [], more: false } }));
      // Each column is its own step: the « Étape » filter (sold, returned) does not apply here.
      const { stage: _, ...columnFilters } = filters;
      fetchItemsPage(toItemQuery(view, columnFilters, profileId), null, undefined, controller.signal).then(
        (page) =>
          // Left (filters or profile changed, or the board closed): an answer of before is dropped, like an error.
          !controller.signal.aborted &&
          setColumns((previous) => ({
            ...previous,
            [step]: { status: "ready", items: page.items, more: page.nextCursor !== null },
          })),
        () =>
          !controller.signal.aborted &&
          setColumns((previous) => ({ ...previous, [step]: { status: "error", items: [], more: false } })),
      );
    }
    return () => controller.abort();
  }, [filtersKey, profileId, reloadKey]);

  const params = new URLSearchParams(search.toString());
  return (
    <section aria-label={t("board.label")} className="grid grid-cols-4 gap-space-3-5">
      {COLUMNS.map(({ step }) => {
        const column = columns[step];
        const label = t(`chips.${step}`);
        const heading = counts ? t("board.column", { label, count: countOf(counts, step) }) : label;
        return (
          <div
            key={step}
            data-testid="stage-column"
            className="flex min-w-space-0 flex-col gap-space-2-5 rounded-card bg-surface-sunken p-space-3-5"
          >
            <h2 className="text-sm font-bold text-ink">{heading}</h2>
            {column?.status === "loading" && <p className="text-sm text-ink-muted">{t("loading")}</p>}
            {column?.status === "error" && (
              <p role="alert" className="text-sm text-danger">
                {t("loadError")}
              </p>
            )}
            {column?.status === "ready" && column.items.length === 0 && (
              <p className="text-sm text-ink-muted">{t("board.empty")}</p>
            )}
            {column?.status === "ready" && column.items.length > 0 && (
              <ul className="flex flex-col gap-space-2-5">
                {column.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/produits/${item.product.id}`}
                      className={`flex items-center gap-space-2-5 rounded-board-row bg-surface-raised p-space-1-5 ${focusRing}`}
                    >
                      <span className="block aspect-3/4 w-board-thumb shrink-0 overflow-hidden rounded-board-thumb bg-media-backdrop">
                        {item.coverUrl && (
                          // biome-ignore lint/performance/noImgElement: photos come from our own API, already resized.
                          <img
                            src={item.coverUrl}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="size-full object-cover"
                          />
                        )}
                      </span>
                      <span className="min-w-space-0 font-title text-sm leading-tight break-words text-ink">
                        {item.name?.trim() || t("card.noName")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {column?.more && (
              <Link href={articlesHref(params, step)} className={`${buttonClass} min-h-touch-target self-start`}>
                {t("board.seeAll")}
              </Link>
            )}
          </div>
        );
      })}
    </section>
  );
}
