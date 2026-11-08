"use client";

import type { LoveLevelView, OpinionView } from "@closyria/shared";
import { useLocale, useTranslations } from "next-intl";
import { levelOf } from "@/lib/love-levels";
import { relativeDate } from "@/lib/relative-date";
import { focusRing } from "./ui";

/** The first letter of a name, for the round badge. */
function initialOf(name: string): string {
  const first = new Intl.Segmenter("fr", { granularity: "grapheme" }).segment(name.trim())[Symbol.iterator]().next();
  return first.done ? "?" : first.value.segment.toLocaleUpperCase("fr");
}

const newestFirst = (opinions: readonly OpinionView[]) =>
  [...opinions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name));

/**
 * Friends' opinions on one item, newest first (spec §3.1, §4.2): initial, name, the owner's emoji and name for the
 * level, the note, when. Names and notes are plain text, never interpreted. « nouveau » on the ones she has not seen;
 * « Effacer » when `onDelete` is given (the owner's app). Nothing when there is no opinion.
 */
export function FriendOpinions({
  opinions,
  levels,
  onDelete,
}: {
  opinions: readonly OpinionView[];
  levels: readonly LoveLevelView[];
  onDelete?: (opinion: OpinionView) => void;
}) {
  const t = useTranslations("Lists.opinions");
  const locale = useLocale();
  if (opinions.length === 0) return null;
  const now = new Date();
  const fresh = opinions.filter((opinion) => opinion.isNew).length;

  return (
    <div className="flex flex-col gap-space-2">
      {fresh > 0 && (
        <span className="self-start rounded-full bg-accent px-space-3 py-space-1 text-caption font-strong text-accent-ink">
          {t("new", { count: fresh })}
        </span>
      )}
      <ul aria-label={t("listLabel")} className="flex flex-col gap-space-2">
        {newestFirst(opinions).map((opinion) => {
          const level = levelOf(levels, opinion.level);
          return (
            <li key={opinion.id} className="flex items-start gap-space-2 text-sm">
              <span
                aria-hidden="true"
                className="flex size-space-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-caption font-strong"
              >
                {initialOf(opinion.name)}
              </span>
              <div
                className={`bubble flex min-w-space-0 flex-1 flex-col bg-hint px-space-3 py-space-2 ${opinion.isNew ? "bubble-new" : ""}`}
              >
                <p className="flex flex-wrap items-center gap-x-space-1">
                  <span className="font-strong break-words">{opinion.name}</span>
                  <span>
                    <span aria-hidden="true">{level.emoji}</span> {level.label}
                  </span>
                </p>
                {opinion.note && <p className="break-words">{opinion.note}</p>}
                <p className="flex flex-wrap items-center gap-x-space-3 text-caption text-ink-muted">
                  <time dateTime={opinion.updatedAt} suppressHydrationWarning>
                    {relativeDate(opinion.updatedAt, now, locale)}
                  </time>
                  {onDelete && (
                    <button
                      type="button"
                      onClick={() => onDelete(opinion)}
                      className={`inline-flex min-h-touch-target items-center rounded-button underline hover:text-ink ${focusRing}`}
                    >
                      {t("erase")}
                      <span className="sr-only"> {t("eraseFor", { name: opinion.name })}</span>
                    </button>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
