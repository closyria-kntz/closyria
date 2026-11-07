"use client";

import { isSingleEmoji, type LoveLevelView, MAX_LOVE_LEVEL_LABEL } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { useLoveLevels, useRefreshLoveLevels } from "@/lib/profile-context";
import { pushUndo } from "@/lib/undo";
import { resetLoveLevels, saveLoveLevels } from "@/lib/wardrobe-client";
import { Dialog } from "./dialog";
import { buttonClass, inputClass, primaryButtonClass } from "./ui";

const touch = "min-h-touch-target";

const COMMON_EMOJIS = [
  "🤍",
  "❤️",
  "🥰",
  "😍",
  "💖",
  "💕",
  "😘",
  "🤩",
  "😊",
  "😕",
  "🙈",
  "😭",
  "🔥",
  "✨",
  "⭐",
  "🌟",
  "🌸",
  "🌷",
  "🌹",
  "🌈",
  "🎀",
  "💎",
  "👑",
  "🛍️",
] as const;

function EmojiPicker({
  open,
  level,
  onClose,
  onPick,
}: {
  open: boolean;
  level: number;
  onClose: () => void;
  onPick: (emoji: string) => void;
}) {
  const t = useTranslations("Settings");
  const fieldId = useId();
  const errorId = useId();
  const [typed, setTyped] = useState("");
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    if (open) {
      setTyped("");
      setInvalid(false);
    }
  }, [open]);
  return (
    <Dialog open={open} onClose={onClose} title={t("levels.pickerTitle")} closeLabel={t("close")}>
      <ul aria-label={t("levels.pickerList", { level })} className="grid grid-cols-6 gap-space-2 sm:grid-cols-8">
        {COMMON_EMOJIS.map((emoji) => (
          <li key={emoji} className="flex">
            <button
              type="button"
              onClick={() => onPick(emoji)}
              className={`${buttonClass} ${touch} min-w-touch-target flex-1 justify-center text-lead`}
            >
              {emoji}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-col gap-space-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = typed.trim();
          if (isSingleEmoji(value)) onPick(value);
          else setInvalid(true);
        }}
      >
        <label htmlFor={fieldId} className="text-sm font-strong">
          {t("levels.typeOwn")}
        </label>
        <div className="flex gap-space-2">
          <input
            id={fieldId}
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
              setInvalid(false);
            }}
            aria-invalid={invalid}
            aria-describedby={invalid ? errorId : undefined}
            className={`${inputClass} ${touch}`}
          />
          <button type="submit" className={`${primaryButtonClass} ${touch}`}>
            {t("levels.use")}
          </button>
        </div>
        {invalid && (
          <p id={errorId} className="text-sm text-danger">
            {t("levels.oneEmoji")}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/** « Réglages › Mes niveaux »: the emoji and name of her 4 levels (spec §3.8). */
export function LoveLevelsSettings() {
  const t = useTranslations("Settings");
  const current = useLoveLevels();
  const refresh = useRefreshLoveLevels();
  const [draft, setDraft] = useState<LoveLevelView[]>(() => current.map((l) => ({ ...l })));
  const [picking, setPicking] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The shell may read her levels after this page opened (or an undo changed them): follow, unless she is mid-edit.
  const currentKey = JSON.stringify(current);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `current` is tracked through its serialized key.
  useEffect(() => {
    setDraft(current.map((l) => ({ ...l })));
  }, [currentKey]);

  const update = (level: number, patch: Partial<LoveLevelView>) =>
    setDraft((rows) => rows.map((row) => (row.level === level ? { ...row, ...patch } : row)));

  /** Replaces her levels (and the shell's copy); false when it did not work. */
  async function put(levels: readonly LoveLevelView[]): Promise<boolean> {
    const result = await saveLoveLevels(levels);
    if (!result.ok) return false;
    await refresh();
    return true;
  }

  async function save() {
    if (busy) return;
    const rows = draft.map((row) => ({ ...row, label: row.label.trim() }));
    if (rows.some((row) => !row.label || row.label.length > MAX_LOVE_LEVEL_LABEL || !isSingleEmoji(row.emoji))) {
      return setError(t("levels.invalid"));
    }
    const before = current.map((l) => ({ ...l }));
    setBusy(true);
    setError(null);
    const ok = await put(rows);
    setBusy(false);
    if (!ok) return setError(t("failed"));
    pushUndo(t("levels.saved"), () => put(before));
  }

  async function reset() {
    if (busy) return;
    const before = current.map((l) => ({ ...l }));
    setBusy(true);
    setError(null);
    const result = await resetLoveLevels();
    if (result.ok) await refresh();
    setBusy(false);
    if (!result.ok) return setError(t("failed"));
    pushUndo(t("levels.resetDone"), () => put(before));
  }

  return (
    <section className="flex flex-col gap-space-5">
      <div className="flex max-w-measure flex-col gap-space-2">
        <h2 className="font-display text-lead font-strong">{t("levels.title")}</h2>
        <p className="text-ink-muted">{t("levels.intro")}</p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        className="flex max-w-measure flex-col gap-space-4"
      >
        <ul aria-label={t("levels.listLabel")} className="flex flex-col gap-space-3">
          {draft.map((row) => (
            <li
              key={row.level}
              className="flex items-end gap-space-3 rounded-card border border-line bg-surface-raised p-space-3"
            >
              <button
                type="button"
                aria-label={t("levels.changeEmoji", { level: row.level })}
                aria-haspopup="dialog"
                onClick={() => setPicking(row.level)}
                className={`${buttonClass} size-12 shrink-0 justify-center text-lead`}
              >
                <span aria-hidden="true">{row.emoji}</span>
              </button>
              <div className="flex min-w-space-0 flex-1 flex-col gap-space-1">
                <span className="text-caption text-ink-muted">
                  {row.level === 1
                    ? t("levels.captionLeast")
                    : row.level === 4
                      ? t("levels.captionMost")
                      : t("levels.caption", { level: row.level })}
                </span>
                <input
                  aria-label={t("levels.nameLabel", { level: row.level })}
                  value={row.label}
                  maxLength={MAX_LOVE_LEVEL_LABEL}
                  onChange={(event) => update(row.level, { label: event.target.value })}
                  className={`${inputClass} ${touch}`}
                />
              </div>
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-space-2">
          <button type="submit" disabled={busy} className={`${primaryButtonClass} ${touch}`}>
            {t("levels.save")}
          </button>
          <button type="button" disabled={busy} onClick={() => void reset()} className={`${buttonClass} ${touch}`}>
            {t("levels.reset")}
          </button>
        </div>
      </form>

      <EmojiPicker
        open={picking !== null}
        level={picking ?? 1}
        onClose={() => setPicking(null)}
        onPick={(emoji) => {
          if (picking !== null) update(picking, { emoji });
          setPicking(null);
        }}
      />
    </section>
  );
}
