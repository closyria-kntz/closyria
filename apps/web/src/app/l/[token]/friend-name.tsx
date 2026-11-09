"use client";

import { OPINION_NAME_MAX, textLength } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { type RefObject, useEffect, useRef } from "react";
import { buttonClass, focusRing, inputClass, primaryButtonClass } from "@/components/ui";

/** The first `max` characters (graphemes) of `value`. */
export function clip(value: string, max: number): string {
  if (textLength(value) <= max) return value;
  const segments = new Intl.Segmenter("fr", { granularity: "grapheme" }).segment(value);
  return Array.from(segments, (s) => s.segment)
    .slice(0, max)
    .join("");
}

/** Her first name as sent: trimmed, inner spaces folded. */
export const cleanName = (value: string) => value.trim().replace(/\s+/g, " ");

/** Whether a cleaned name has the right length (1 to 40 characters). */
export const nameFits = (value: string) => textLength(value) >= 1 && textLength(value) <= OPINION_NAME_MAX;

/**
 * Her first name on the link (opinions and gifts alike, spec §3.2): a field when this device does not know it, else
 * the name it remembers with « Ce n'est pas moi » (someone else on this device).
 */
export function FriendNameStep({
  askName,
  knownName,
  name,
  onNameChange,
  onNotMe,
  inputId,
  inputRef,
}: {
  askName: boolean;
  knownName: string | null;
  name: string;
  onNameChange: (name: string) => void;
  onNotMe: () => void;
  inputId: string;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const t = useTranslations("SharedList.friend");
  if (askName || knownName === null) {
    return (
      <div className="flex flex-col gap-space-1">
        <label htmlFor={inputId} className="text-sm text-ink-muted">
          {t("nameLabel")}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          autoComplete="given-name"
          enterKeyHint="next"
          value={name}
          onChange={(event) => onNameChange(clip(event.target.value, OPINION_NAME_MAX))}
          className={`${inputClass} min-h-touch-target`}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-space-2">
      <p className="flex flex-col">
        <span className="text-sm text-ink-muted">{t("nameKnown")}</span>
        <span className="font-strong">{knownName}</span>
      </p>
      <button
        type="button"
        onClick={onNotMe}
        className={`rounded-button px-space-2 text-sm text-accent underline min-h-touch-target ${focusRing}`}
      >
        {t("notMe")}
      </button>
    </div>
  );
}

/**
 * « Une Léa a déjà… C'est toi ? »: another device uses the name on the list. « Oui, c'est moi » attaches this
 * device; « Non » asks for another name. Takes the focus when it shows (it replaces the send button).
 */
export function NameTakenQuestion({
  id,
  question,
  busy,
  onItsMe,
  onNotHer,
}: {
  id: string;
  question: string;
  busy: boolean;
  onItsMe: () => void;
  onNotHer: () => void;
}) {
  const t = useTranslations("SharedList.friend");
  const itsMe = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    itsMe.current?.focus();
  }, []);
  return (
    <fieldset className="flex min-w-space-0 flex-col gap-space-2" aria-labelledby={id}>
      <p id={id} role="alert" className="font-strong">
        {question}
      </p>
      <div className="grid grid-cols-2 gap-space-2">
        <button
          ref={itsMe}
          type="button"
          disabled={busy}
          onClick={onItsMe}
          className={`${primaryButtonClass} min-h-touch-target`}
        >
          {t("itsMe")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onNotHer}
          className={`${buttonClass} min-h-touch-target justify-center font-strong`}
        >
          {t("notHer")}
        </button>
      </div>
    </fieldset>
  );
}
