"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { ARTICLES_PATH } from "@/lib/articles-address";
import { phoneKind } from "@/lib/phone-kind";
import { profileHref, useCurrentProfile } from "@/lib/profile-context";
import { extractSharedUrl } from "@/lib/shared-url";
import { useCoarsePointer } from "@/lib/use-desktop";
import { CaptureForm } from "./capture-form";
import { Sheet } from "./sheet";
import { buttonClass, focusRing } from "./ui";

type Step = "choose" | "link" | "photo" | "share";

/** The ways to add an article (mockup .opt), the e-mail one still to come; « Coller le lien copié » on a touch screen. */
const OPTIONS = ["link", "photo", "share", "mail"] as const;
type Option = "paste" | (typeof OPTIONS)[number];

/** Line icons of the options, drawn like the bottom bar's. */
function OptionIcon({ name }: { name: Option }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-nav-icon fill-none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "paste" && (
        <>
          <path d="M9 4h6v3H9z" />
          <path d="M9 5.5H7a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-2" />
          <path d="M9.5 13.5l2 2 3.5-4" />
        </>
      )}
      {name === "link" && (
        <>
          <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
          <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
        </>
      )}
      {name === "photo" && (
        <>
          <path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
          <circle cx="12" cy="13" r="3.5" />
        </>
      )}
      {name === "share" && (
        <>
          <path d="M12 15V4M8 8l4-4 4 4" />
          <path d="M6 12v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-7" />
        </>
      )}
      {name === "mail" && (
        <>
          <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
          <path d="M9 8h6M9 12h6" />
        </>
      )}
    </svg>
  );
}

const optionClass = `flex min-h-touch-target w-full items-center gap-space-3 rounded-card bg-surface-sunken p-space-3 text-left hover:bg-surface-strong disabled:cursor-default disabled:hover:bg-surface-sunken ${focusRing}`;

/**
 * « Ajouter un article » (refonte Boudoir, spec §2 R7): the + of the phone and « + Ajouter » of the band open it — a
 * sheet from the bottom on a phone, a centered window on a computer. « Coller un lien » shows the paste field, the
 * other ways explain themselves; transferring an order e-mail comes later. On a touch screen, « Coller le lien copié »
 * comes first: it reads the clipboard in the tap and adds the link at once, or asks her to copy it first and opens the
 * paste field. On an iPhone, an iPad or an Android phone, « Partager depuis une boutique » leads to the phone help.
 */
export function AddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("Add");
  const { id: profileId, isDefault } = useCurrentProfile();
  const articlesHref = profileHref(ARTICLES_PATH, profileId, isDefault);
  const titleId = useId();
  const pathname = usePathname();
  const [step, setStep] = useState<Step>("choose");
  const touch = useCoarsePointer();
  const [phone, setPhone] = useState(false);
  // « Coller le lien copié »: the link read from the clipboard (added at once), or nothing usable there.
  const [pasted, setPasted] = useState<{ url: string } | { empty: true } | null>(null);
  useEffect(() => {
    setPhone(phoneKind(navigator.userAgent, navigator.maxTouchPoints) !== null);
  }, []);
  const body = useRef<HTMLDivElement>(null);
  const opened = useRef(pathname);

  // Each opening starts on the choice.
  useEffect(() => {
    if (open) setStep("choose");
  }, [open]);
  useEffect(() => {
    if (step !== "link") setPasted(null);
  }, [step]);

  /** Reads the clipboard in the tap: a link is added like a pasted one; nothing usable opens the field. */
  async function pasteCopied() {
    let copied = "";
    try {
      copied = await navigator.clipboard.readText();
    } catch {
      // Refused: same as nothing copied.
    }
    const url = extractSharedUrl({ text: copied });
    setPasted(url ? { url } : { empty: true });
    setStep("link");
  }
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
            {(touch ? (["paste", ...OPTIONS] as const) : OPTIONS).map((key: Option) => {
              const soon = key === "mail";
              const inner = (
                <>
                  <span
                    aria-hidden="true"
                    className="grid size-touch-target shrink-0 place-items-center rounded-full bg-surface-raised text-accent"
                  >
                    <OptionIcon name={key} />
                  </span>
                  <span className="flex flex-col">
                    <span className="font-bold">{t(`${key}.title`)}</span>
                    <span className="text-sm text-ink-muted">{t(`${key}.detail`)}</span>
                  </span>
                </>
              );
              return (
                <li key={key} className="flex flex-col">
                  {key === "share" && phone ? (
                    <Link href="/aide/telephone" onClick={onClose} data-option={key} className={optionClass}>
                      {inner}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      data-option={key}
                      disabled={soon}
                      onClick={soon ? undefined : key === "paste" ? () => void pasteCopied() : () => setStep(key)}
                      className={optionClass}
                    >
                      {inner}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {step === "link" && (
          <>
            {pasted && "empty" in pasted && (
              <p role="alert" className="font-bold">
                {t("paste.empty")}
              </p>
            )}
            {pasted && "url" in pasted ? (
              <CaptureForm key={pasted.url} initialUrl={pasted.url} autoSubmit replace={false} />
            ) : (
              <CaptureForm />
            )}
            {back}
          </>
        )}
        {step === "share" && (
          <>
            <p>{t("share.explain")}</p>
            <p className="text-ink-muted">{t("share.android")}</p>
            <p className="text-ink-muted">
              {t("share.iphone")}{" "}
              <Link href="/aide/telephone" onClick={onClose} className={`font-strong text-ink underline ${focusRing}`}>
                {t("share.phoneLink")}
              </Link>
            </p>
            {back}
          </>
        )}
        {step === "photo" && (
          <>
            <p>{t("photo.explain")}</p>
            <Link
              href={articlesHref}
              onClick={onClose}
              className={`${buttonClass} min-h-touch-target self-start font-strong`}
            >
              {t("photo.open")}
            </Link>
            {back}
          </>
        )}
      </div>
    </Sheet>
  );
}
