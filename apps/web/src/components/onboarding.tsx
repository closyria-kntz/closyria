"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { focusRing, primaryButtonClass } from "./ui";

const STEPS = ["watch", "friends", "wardrobe"] as const;
type Step = (typeof STEPS)[number];

/** Drawn pictures of the screens (no photo of a real shop): a dress, a gift, a hanger, in the accent on powder pink. */
function Picture({ step }: { step: Step }) {
  return (
    <svg
      viewBox="0 0 120 120"
      aria-hidden="true"
      className="size-1/2 max-h-full fill-none text-accent"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {step === "watch" && (
        <>
          <path d="M48 14c0 7 5 11 12 11s12-4 12-11" />
          <path d="M48 14 40 18l4 22-14 62c18 6 42 6 60 0L76 40l4-22-8-4" />
          <path d="M44 40h32" />
          <path d="M52 60l-4 36M68 60l4 36" />
        </>
      )}
      {step === "friends" && (
        <>
          <rect x="22" y="48" width="76" height="54" rx="6" />
          <path d="M18 36h84v14H18zM60 36v66" />
          <path d="M60 36c-6-12-24-16-24-4s18 4 24 4c6 0 24 8 24-4s-18-8-24 4" />
        </>
      )}
      {step === "wardrobe" && (
        <>
          <path d="M60 30a8 8 0 1 1 8-8c0 5-8 6-8 12v6" />
          <path d="M60 40 14 72c-4 3-2 8 3 8h86c5 0 7-5 3-8z" />
          <path d="M30 80v20M90 80v20M46 80v26M74 80v26" />
        </>
      )}
    </svg>
  );
}

/**
 * The first-opening discovery (refonte Boudoir, spec R8, mockup bienvenue()): three screens, one at a time — a
 * picture with its ochre tags, « 1 sur 3 », a title, one sentence, dots, « Continuer » and « Passer ». Over the whole
 * page (a modal dialog); « Passer », Escape or the last screen's button end it for good (`onDone`).
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const t = useTranslations("Onboarding");
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const textId = useId();
  const [index, setIndex] = useState(0);
  const step = STEPS[index] as Step;
  const last = index === STEPS.length - 1;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const next = () => (last ? ref.current?.close() : setIndex(index + 1));

  return (
    <dialog
      ref={ref}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={textId}
      onClose={onDone}
      className="m-space-0 h-dvh max-h-full w-full max-w-full bg-surface p-space-0 text-ink backdrop:bg-surface open:flex"
    >
      <div className="mx-auto flex w-full max-w-discovery flex-col gap-space-4 px-space-5 py-space-6 text-center md:my-auto md:h-auto">
        <div className="relative flex min-h-space-0 flex-1 items-center justify-center overflow-hidden rounded-discovery bg-une md:aspect-4/3 md:flex-none">
          <Picture step={step} />
          <span
            aria-hidden="true"
            className="absolute top-space-3-5 left-space-3-5 flex flex-col items-start gap-space-2"
          >
            <span className="clothing-tag relative">{t(`${step}.tag1`)}</span>
            <span className="clothing-tag relative bg-surface-raised text-accent">{t(`${step}.tag2`)}</span>
          </span>
        </div>
        <div aria-live="polite" className="flex flex-col gap-space-4">
          <span className="text-meta font-bold tracking-wide text-accent uppercase">
            {t("count", { step: index + 1, total: STEPS.length })}
          </span>
          <h2 id={titleId} className="font-title text-discovery-title leading-tight font-regular">
            {t(`${step}.title`)}
          </h2>
          <p id={textId} className="text-sm text-ink-muted">
            {t(`${step}.text`)}
          </p>
        </div>
        <span aria-hidden="true" className="flex justify-center gap-space-1-5">
          {STEPS.map((s, n) => (
            <i
              key={s}
              className={`block h-space-2 rounded-pill ${n === index ? "w-space-5-5 bg-button-bg" : "w-space-2 bg-line"}`}
            />
          ))}
        </span>
        <div className="flex flex-col gap-space-1">
          <button type="button" onClick={next} className={`${primaryButtonClass} min-h-touch-target text-ui`}>
            {last ? t("start") : t("next")}
          </button>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className={`mx-auto inline-flex min-h-touch-target items-center px-space-3 text-chip font-bold underline underline-offset-3 ${focusRing}`}
          >
            {t("skip")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
