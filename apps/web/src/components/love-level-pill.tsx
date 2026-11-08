"use client";

import type { ItemView, LoveLevel } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { levelOf } from "@/lib/love-levels";
import { useLoveLevels } from "@/lib/profile-context";
import { pushUndo } from "@/lib/undo";
import { patchItem, undoWith } from "@/lib/wardrobe-client";
import { LevelPicker, LevelSparks } from "./level-picker";
import { shouldSpark } from "./level-picker-logic";
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
 * The level emoji laid alone on the photo (no disc, only a soft shadow on the glyph). A click on it, or a double tap on
 * the photo (the card opens `open`), shows the bubble with her 4 levels; nothing changes until she picks one, then
 * « Niveau : Mims · Annuler ». Never removes the item (spec §4).
 */
export function LoveLevelPill({
  item,
  onChange,
  reload,
  open,
  onOpenChange,
}: {
  item: ItemView;
  onChange: (item: ItemView) => void;
  /** Re-reads what changed (after « Annuler »). */
  reload: () => Promise<void>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("Views");
  const tCard = useTranslations("Views.card");
  const tErrors = useTranslations("Item.errors");
  const levels = useLoveLevels();
  const [busy, setBusy] = useState(false);
  const [sparks, setSparks] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const current = item.loveLevel === null ? null : levelOf(levels, item.loveLevel);
  const name = item.name?.trim() || tCard("noName");

  async function pick(level: LoveLevel) {
    onOpenChange(false);
    anchor?.focus();
    if (busy || level === item.loveLevel) return;
    setSparks(shouldSpark(level) && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    setBusy(true);
    const result = await patchItem(item.id, { loveLevel: level });
    setBusy(false);
    if (!result.ok) return pushUndo(tErrors(result.error as "failed"), null);
    onChange(result.item);
    pushUndo(t("menu.toast.levelOf", { name, label: levelOf(levels, level).label }), undoWith(result.undo, reload));
  }

  return (
    <>
      <div className="absolute top-space-0 left-space-0 z-10">
        <button
          ref={setAnchor}
          type="button"
          aria-label={current ? t("card.level", { name, label: current.label }) : t("card.levelAdd", { name })}
          aria-expanded={open}
          aria-busy={busy || undefined}
          onClick={() => onOpenChange(!open)}
          className={`flex min-h-touch-target min-w-touch-target items-center justify-center rounded-card p-space-1 text-title leading-none ${focusRing}`}
        >
          {current ? (
            <span aria-hidden="true" className="drop-shadow-emoji">
              {current.emoji}
            </span>
          ) : (
            <span
              aria-hidden="true"
              className="glass flex size-space-6 items-center justify-center rounded-full text-lead font-strong text-ink"
            >
              +
            </span>
          )}
        </button>
        {sparks && <LevelSparks onDone={() => setSparks(false)} />}
      </div>
      {open && anchor && (
        <LevelPicker
          levels={levels}
          value={item.loveLevel}
          anchor={anchor}
          label={tCard("pickerLabel", { name })}
          onPick={(level) => void pick(level)}
          onClose={() => onOpenChange(false)}
        />
      )}
    </>
  );
}
