"use client";

import {
  containsWebAddress,
  type LoveLevel,
  type LoveLevelView,
  OPINION_NAME_MAX,
  OPINION_NOTE_MAX,
  type OpinionView,
  opinionNameKey,
  textLength,
} from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { Sheet } from "@/components/sheet";
import { buttonClass, focusRing, inputClass, levelButtonClass, primaryButtonClass } from "@/components/ui";
import type { FriendDevice } from "@/lib/friend-device";
import { deleteOpinion, type OpinionError, putOpinion } from "@/lib/shared-list";

/** A multi-line field: the input's look with softer corners (a pill does not suit several lines). */
const noteClass = inputClass.replace("rounded-button", "rounded-md");

/** The note's counter shows from this many characters (spec §3.2). */
export const NOTE_COUNTER_FROM = 150;

/** What happened, for the page's « … · Annuler » message. */
export type SheetOutcome =
  | { kind: "sent"; name: string; previous: OpinionView | undefined }
  | { kind: "erased"; previous: OpinionView };

type Props = {
  open: boolean;
  onClose: () => void;
  token: string;
  item: { itemId: string; name: string; opinions: OpinionView[] };
  /** Every opinion on the list: how a name already used elsewhere is written (« Une Léa… »). */
  listOpinions: OpinionView[];
  levels: LoveLevelView[];
  device: FriendDevice;
  onDone: (outcome: SheetOutcome) => void;
};

/** The first `max` characters (graphemes) of `value`. */
function clip(value: string, max: number): string {
  if (textLength(value) <= max) return value;
  const segments = new Intl.Segmenter("fr", { granularity: "grapheme" }).segment(value);
  return Array.from(segments, (s) => s.segment)
    .slice(0, max)
    .join("");
}

const errorKey: Record<OpinionError, "webAddress" | "rateLimited" | "closed" | "gone" | "failed"> = {
  web_address: "webAddress",
  rate_limited: "rateLimited",
  opinions_closed: "closed",
  not_found: "gone",
  name_taken: "failed",
  forbidden: "failed",
  failed: "failed",
};

const findByName = (opinions: OpinionView[], name: string) =>
  opinions.find((o) => opinionNameKey(o.name) === opinionNameKey(name));

/**
 * « Ton avis sur {article} »: her first name (asked once per device), one of the owner's 4 levels, a short note.
 * Opened filled (with « Effacer mon avis ») when this device already gave one on the item.
 */
export function OpinionSheet({ open, onClose, token, item, listOpinions, levels, device, onDone }: Props) {
  const t = useTranslations("SharedList.opinions");
  const titleId = useId();
  const nameId = useId();
  const noteId = useId();
  const counterId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const mine = device.name ? findByName(item.opinions, device.name) : undefined;

  const [askName, setAskName] = useState(device.name === null);
  const [name, setName] = useState("");
  const [level, setLevel] = useState<LoveLevel | null>(mine?.level ?? null);
  const [note, setNote] = useState(mine?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  // The name another device already uses on the list, as it is written there.
  const [taken, setTaken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const noteLength = textLength(note);

  function focusName() {
    requestAnimationFrame(() => nameInput.current?.focus());
  }

  async function send(claim: boolean) {
    const chosen = (askName ? name : (device.name ?? "")).trim().replace(/\s+/g, " ");
    const text = note.trim();
    if (textLength(chosen) < 1 || textLength(chosen) > OPINION_NAME_MAX) {
      setError(t("errors.name"));
      if (askName) focusName();
      return;
    }
    if (level === null) return setError(t("errors.level"));
    if (containsWebAddress(text)) return setError(t("errors.webAddress"));
    setError(null);
    setBusy(true);
    const previous = findByName(item.opinions, chosen);
    const result = await putOpinion(token, item.itemId, {
      name: chosen,
      level,
      note: text === "" ? null : text,
      deviceKey: device.key,
      ...(claim ? { claim: true } : {}),
    });
    setBusy(false);
    if (result.ok) {
      device.setName(chosen);
      onDone({ kind: "sent", name: chosen, previous });
      return;
    }
    if (result.error === "name_taken") {
      setTaken(findByName(listOpinions, chosen)?.name ?? chosen);
      return;
    }
    setError(t(`errors.${errorKey[result.error]}`));
  }

  async function erase() {
    if (!mine || !device.name) return;
    setBusy(true);
    const result = await deleteOpinion(token, item.itemId, { name: device.name, deviceKey: device.key });
    setBusy(false);
    if (result.ok) onDone({ kind: "erased", previous: mine });
    else setError(t(result.error === "opinions_closed" ? "errors.closed" : "errors.eraseFailed"));
  }

  function notHer() {
    if (!taken) return;
    setName(`${taken} M.`);
    setAskName(true);
    setTaken(null);
    focusName();
  }

  function notMe() {
    setAskName(true);
    setName("");
    setError(null);
    focusName();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      closeLabel={t("close")}
      hint={t("closeHint")}
      footer={
        <div className="flex flex-col gap-space-2 border-t border-line p-space-4">
          {taken ? (
            <fieldset className="flex min-w-space-0 flex-col gap-space-2" aria-labelledby={`${titleId}-taken`}>
              <p id={`${titleId}-taken`} className="font-strong">
                {t("nameTaken", { name: taken })}
              </p>
              <div className="grid grid-cols-2 gap-space-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void send(true)}
                  className={`${primaryButtonClass} min-h-touch-target`}
                >
                  {t("itsMe")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={notHer}
                  className={`${buttonClass} min-h-touch-target justify-center font-strong`}
                >
                  {t("notHer")}
                </button>
              </div>
            </fieldset>
          ) : (
            <>
              <button
                type="submit"
                form={`${titleId}-form`}
                disabled={busy}
                aria-busy={busy || undefined}
                className={`${primaryButtonClass} min-h-touch-target w-full`}
              >
                {t("send")}
              </button>
              <p className="text-center text-caption text-ink-muted">{t("visible")}</p>
              {mine && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void erase()}
                  className={`self-center rounded-button px-space-2 text-sm text-ink-muted underline min-h-touch-target ${focusRing}`}
                >
                  {t("erase")}
                </button>
              )}
            </>
          )}
        </div>
      }
    >
      <h2 id={titleId} className="font-display text-lead font-strong">
        {t("sheetTitle", { name: item.name })}
      </h2>
      <form
        id={`${titleId}-form`}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void send(false);
        }}
        className="flex flex-col gap-space-4"
      >
        {askName ? (
          <div className="flex flex-col gap-space-1">
            <label htmlFor={nameId} className="text-sm text-ink-muted">
              {t("nameLabel")}
            </label>
            <input
              ref={nameInput}
              id={nameId}
              type="text"
              autoComplete="given-name"
              enterKeyHint="next"
              value={name}
              onChange={(event) => {
                setName(clip(event.target.value, OPINION_NAME_MAX));
                setTaken(null);
              }}
              className={`${inputClass} min-h-touch-target`}
            />
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-space-2">
            <p className="flex flex-col">
              <span className="text-sm text-ink-muted">{t("nameKnown")}</span>
              <span className="font-strong">{device.name}</span>
            </p>
            <button
              type="button"
              onClick={notMe}
              className={`rounded-button px-space-2 text-sm text-accent underline min-h-touch-target ${focusRing}`}
            >
              {t("notMe")}
            </button>
          </div>
        )}

        <fieldset className="flex min-w-space-0 flex-col gap-space-2">
          <legend className="pb-space-2 text-sm text-ink-muted">{t("levels")}</legend>
          <div className="grid grid-cols-4 gap-space-2">
            {levels.map((entry) => (
              <button
                key={entry.level}
                type="button"
                aria-pressed={level === entry.level}
                onClick={() => {
                  setLevel(entry.level);
                  setError(null);
                }}
                className={levelButtonClass}
              >
                <span aria-hidden="true" className="text-lead">
                  {entry.emoji}
                </span>
                <span className="max-w-full truncate">{entry.label}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-space-1">
          <label htmlFor={noteId} className="text-sm text-ink-muted">
            {t("noteLabel")}
          </label>
          <textarea
            id={noteId}
            rows={3}
            value={note}
            aria-describedby={noteLength >= NOTE_COUNTER_FROM ? counterId : undefined}
            onChange={(event) => {
              setNote(clip(event.target.value, OPINION_NOTE_MAX));
              setError(null);
            }}
            className={`${noteClass} resize-none`}
          />
          {noteLength >= NOTE_COUNTER_FROM && (
            <p id={counterId} className="self-end text-caption text-ink-muted tabular-nums">
              {t("counter", { count: noteLength, max: OPINION_NOTE_MAX })}
            </p>
          )}
        </div>

        <p role="alert" className="text-sm text-danger empty:hidden">
          {error}
        </p>
      </form>
    </Sheet>
  );
}
