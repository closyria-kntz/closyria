"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { ARTICLES_PATH } from "@/lib/articles-address";
import { CaptureForm } from "./capture-form";
import { Sheet } from "./sheet";
import { buttonClass, focusRing } from "./ui";

type Step = "choose" | "link" | "photo" | "share";

/** The four ways to add an article (mockup .opt), the e-mail one still to come. */
const OPTIONS = [
  { key: "link", icon: "🔗" },
  { key: "photo", icon: "📷" },
  { key: "share", icon: "📤" },
  { key: "mail", icon: "🧾" },
] as const;

const optionClass = `flex min-h-touch-target w-full items-center gap-space-3 rounded-card bg-surface-sunken p-space-3 text-left hover:bg-surface-strong disabled:cursor-default disabled:hover:bg-surface-sunken ${focusRing}`;

/**
 * « Ajouter un article » (refonte Boudoir, spec §2 R7): the + of the phone and « + Ajouter » of the band open it — a
 * sheet from the bottom on a phone, a centered window on a computer. « Coller un lien » shows the paste field, the
 * other ways explain themselves; transferring an order e-mail comes later.
 */
export function AddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("Add");
  const titleId = useId();
  const pathname = usePathname();
  const [step, setStep] = useState<Step>("choose");
  const body = useRef<HTMLDivElement>(null);
  const opened = useRef(pathname);

  // Each opening starts on the choice.
  useEffect(() => {
    if (open) setStep("choose");
  }, [open]);
  // An added link opens its sheet: the window closes on the way.
  useEffect(() => {
    if (!open) opened.current = pathname;
    else if (pathname !== opened.current) onClose();
  }, [open, pathname, onClose]);
  // The paste field takes the focus; back on the choice, the option she came from does.
  const from = useRef<Step>("choose");
  useEffect(() => {
    if (!open) return;
    const root = body.current;
    if (step === "link") root?.querySelector("input")?.focus();
    else if (step === "choose" && from.current !== "choose") {
      root?.querySelector<HTMLButtonElement>(`[data-option=${from.current}]`)?.focus();
    }
    from.current = step;
  }, [open, step]);

  const back = (
    <button type="button" onClick={() => setStep("choose")} className={`${buttonClass} min-h-touch-target self-start`}>
      <span aria-hidden="true">←</span>
      {t("back")}
    </button>
  );

  return (
    <Sheet open={open} onClose={onClose} labelledBy={titleId} closeLabel={t("close")} hint={t("closeHint")} fit>
      <div ref={body} className="flex flex-col gap-space-2-5">
        <h2 id={titleId} className="font-title text-heading">
          {t("title")}
        </h2>
        {(step === "share" || step === "photo") && <h3 className="font-bold">{t(`${step}.title`)}</h3>}
        {step === "choose" && (
          <ul className="flex flex-col gap-space-2-5">
            {OPTIONS.map(({ key, icon }) => {
              const soon = key === "mail";
              return (
                <li key={key} className="flex flex-col">
                  <button
                    type="button"
                    data-option={key}
                    disabled={soon}
                    onClick={soon ? undefined : () => setStep(key)}
                    className={optionClass}
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-touch-target shrink-0 place-items-center rounded-full bg-surface-raised text-heading"
                    >
                      {icon}
                    </span>
                    <span className="flex flex-col">
                      <span className="font-bold">{t(`${key}.title`)}</span>
                      <span className="text-sm text-ink-muted">{t(`${key}.detail`)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {step === "link" && (
          <>
            <CaptureForm />
            {back}
          </>
        )}
        {step === "share" && (
          <>
            <p>{t("share.explain")}</p>
            <p className="text-ink-muted">{t("share.android")}</p>
            <p className="text-ink-muted">
              {t("share.iphone")}{" "}
              <Link href="/aide/iphone" className={`font-strong text-ink underline ${focusRing}`}>
                {t("share.iphoneLink")}
              </Link>
            </p>
            {back}
          </>
        )}
        {step === "photo" && (
          <>
            <p>{t("photo.explain")}</p>
            <Link href={ARTICLES_PATH} className={`${buttonClass} min-h-touch-target self-start font-strong`}>
              {t("photo.open")}
            </Link>
            {back}
          </>
        )}
      </div>
    </Sheet>
  );
}
