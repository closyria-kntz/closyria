"use client";

import {
  containsWebAddress,
  type LoveLevel,
  type LoveLevelView,
  OPINION_NOTE_MAX,
  type OpinionView,
  opinionNameKey,
  textLength,
} from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { Sheet } from "@/components/sheet";
import { focusRing, levelButtonClass, primaryButtonClass, textareaClass } from "@/components/ui";
import type { FriendDevice } from "@/lib/friend-device";
import { deleteOpinion, type OpinionError, putOpinion } from "@/lib/shared-list";
import { cleanName, clip, FriendNameStep, NameTakenQuestion, nameFits } from "./friend-name";

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
  /** A write was refused (other than « name taken »): the page reads the list again. */
  onFailed: () => void;
};

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
export function OpinionSheet({ open, onClose, token, item, listOpinions, levels, device, onDone, onFailed }: Props) {
  const t = useTranslations("SharedList.opinions");
  const tFriend = useTranslations("SharedList.friend");
  const titleId = useId();
  const nameId = useId();
  const noteId = useId();
  const counterId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  // This device's opinion on the item, under the name it remembers.
  const own = device.name ? findByName(item.opinions, device.name) : undefined;

  const [askName, setAskName] = useState(device.name === null);
  const [name, setName] = useState("");
  const [level, setLevel] = useState<LoveLevel | null>(own?.level ?? null);
  const [note, setNote] = useState(own?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  // The name another device already uses on the list, as it is written there.
  const [taken, setTaken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // « Ce n'est pas moi »: someone else on this device, who must not edit or erase that opinion.
  const mine = askName ? undefined : own;
  const noteLength = textLength(note);

  function focusName() {
    requestAnimationFrame(() => nameInput.current?.focus());
  }

  async function send(claim: boolean) {
    const chosen = cleanName(askName ? name : (device.name ?? ""));
    const text = note.trim();
    if (!nameFits(chosen)) {
      setError(t("errors.name"));
      if (askName) focusName();
      return;
    }
    if (level === null) return setError(t("errors.level"));
    if (containsWebAddress(chosen) || containsWebAddress(text)) return setError(t("errors.webAddress"));
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
    onFailed();
  }

  async function erase() {
    if (!mine || !device.name) return;
    setBusy(true);
    const result = await deleteOpinion(token, item.itemId, { name: device.name, deviceKey: device.key });
    setBusy(false);
    if (result.ok) onDone({ kind: "erased", previous: mine });
    else {
      setError(t(result.error === "opinions_closed" ? "errors.closed" : "errors.eraseFailed"));
      onFailed();
    }
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
    setLevel(null);
    setNote("");
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
            <NameTakenQuestion
              id={`${titleId}-taken`}
              question={tFriend("nameTaken", { name: taken })}
              busy={busy}
              onItsMe={() => void send(true)}
              onNotHer={notHer}
            />
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
        <FriendNameStep
          askName={askName}
          knownName={device.name}
          name={name}
          onNameChange={(value) => {
            setName(value);
            setTaken(null);
          }}
          onNotMe={notMe}
          inputId={nameId}
          inputRef={nameInput}
        />

        <fieldset className="flex min-w-space-0 flex-col gap-space-2">
          <legend className="pb-space-2 text-sm text-ink-muted">{t("levels")}</legend>
          <div className="grid grid-cols-2 gap-space-2 sm:grid-cols-4">
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
                <span className="max-w-full break-words">{entry.label}</span>
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
            className={`${textareaClass} resize-none`}
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
