"use client";

import type { ItemView } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { levelOf, nextLoveLevel } from "@/lib/love-levels";
import { useLoveLevels } from "@/lib/profile-context";
import { pushUndo } from "@/lib/undo";
import { patchItem, undoWith } from "@/lib/wardrobe-client";
import { focusRing } from "./ui";

/** The look of the pill: emoji and name on translucent white, top left of the photo (spec §3.2). */
export const pillClass =
  "inline-flex min-w-space-0 max-w-full items-center gap-space-1 overflow-hidden whitespace-nowrap rounded-full bg-surface-raised/85 px-space-2 py-space-1 text-caption font-strong text-ink border border-line";

/** Her level, shown without a way to change it (the trash). */
export function LoveLevelBadge({ item }: { item: ItemView }) {
  const levels = useLoveLevels();
  if (item.loveLevel === null) return null;
  const { emoji, label } = levelOf(levels, item.loveLevel);
  return (
    <span className={`${pillClass} pointer-events-none absolute top-space-2 left-space-2 max-w-3/4`}>
      <span aria-hidden="true">{emoji}</span>
      <span className="min-w-space-0 truncate">{label}</span>
    </span>
  );
}

/**
 * The level pill of a card: one tap moves to the next level (« + » gives « J'aime » to a wish without one), with
 * « Niveau : Mims · Annuler ». Never removes the item (spec §4).
 */
export function LoveLevelPill({
  item,
  onChange,
  reload,
}: {
  item: ItemView;
  onChange: (item: ItemView) => void;
  /** Re-reads what changed (after « Annuler »). */
  reload: () => Promise<void>;
}) {
  const t = useTranslations("Views");
  const tCard = useTranslations("Views.card");
  const tErrors = useTranslations("Item.errors");
  const levels = useLoveLevels();
  const [busy, setBusy] = useState(false);
  const current = item.loveLevel === null ? null : levelOf(levels, item.loveLevel);
  const name = item.name?.trim() || tCard("noName");

  async function next() {
    if (busy) return;
    setBusy(true);
    const level = nextLoveLevel(item.loveLevel);
    const result = await patchItem(item.id, { loveLevel: level });
    setBusy(false);
    if (!result.ok) return pushUndo(tErrors(result.error as "failed"), null);
    onChange(result.item);
    pushUndo(t("menu.toast.levelOf", { name, label: levelOf(levels, level).label }), undoWith(result.undo, reload));
  }

  return (
    <button
      type="button"
      aria-label={current ? t("card.level", { name, label: current.label }) : t("card.levelAdd", { name })}
      aria-busy={busy || undefined}
      onClick={() => void next()}
      className={`absolute top-space-0 left-space-0 z-10 flex min-h-touch-target min-w-touch-target max-w-3/4 items-center rounded-card p-space-2 ${focusRing}`}
    >
      <span aria-hidden="true" className={pillClass}>
        {current ? (
          <>
            <span>{current.emoji}</span>
            <span className="min-w-space-0 truncate">{current.label}</span>
          </>
        ) : (
          <span className="px-space-1">+</span>
        )}
      </span>
    </button>
  );
}
