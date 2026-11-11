"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { shareLinks } from "@/lib/share-links";
import { COPIED_FEEDBACK_MS } from "@/lib/timing";
import { useCoarsePointer } from "@/lib/use-desktop";
import { Sheet } from "./sheet";
import { focusRing, inputClass } from "./ui";

type Choice = "copy" | "whatsapp" | "sms" | "email" | "messenger" | "more";

/** Line glyphs drawn like the bottom bar's: no brand logos, the written label says which app. */
function ChoiceIcon({ name }: { name: Choice }) {
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
      {name === "copy" && (
        <>
          <rect x="8" y="8" width="12" height="12" rx="2" />
          <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
        </>
      )}
      {name === "whatsapp" && (
        <>
          <path d="M4 20l1.3-3.9A8 8 0 1 1 8 18.8z" />
          <path d="M9.5 9.5c0 2.5 2.5 5 5 5" />
        </>
      )}
      {name === "sms" && (
        <>
          <path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
          <path d="M8 10h8M8 13h5" />
        </>
      )}
      {name === "email" && (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M4 7l8 6 8-6" />
        </>
      )}
      {name === "messenger" && (
        <>
          <path d="M12 3c5 0 9 3.6 9 8.2s-4 8.2-9 8.2c-1 0-2-.1-2.9-.4L5 21v-3.6C3.8 15.9 3 14.1 3 11.2 3 6.6 7 3 12 3z" />
          <path d="M8 13l3-3 2 2 3-3" />
        </>
      )}
      {name === "more" && (
        <>
          <circle cx="6" cy="12" r="1.2" />
          <circle cx="12" cy="12" r="1.2" />
          <circle cx="18" cy="12" r="1.2" />
        </>
      )}
    </svg>
  );
}

const choiceClass = `flex min-h-touch-target w-full items-center gap-space-3 rounded-card bg-surface-sunken p-space-2-5 text-left font-bold hover:bg-surface-strong ${focusRing}`;
const iconClass = "grid size-touch-target shrink-0 place-items-center rounded-full bg-surface-raised text-accent";

/**
 * « Partager » (refonte Boudoir, task 9): one window for the product, a shared list and a group order's message. In
 * order: « Copier le lien » (or « Copier le message » with `copy="message"`), WhatsApp, SMS, E-mail, Messenger (on a
 * touch screen only) and « Autres applis… » (only when the browser has a share menu). The copy happens in the click;
 * « Copié ✓ » shows for a moment; if the clipboard refuses, the text shows below, selected, to copy by hand.
 */
export function ShareSheet({
  open,
  onClose,
  title,
  text,
  url,
  copy = "link",
}: {
  open: boolean;
  onClose: () => void;
  /** What is shared (a product's or a list's name): under the window's title, and the share menu's title. */
  title: string;
  /** The message: sent with the link after it, unless it already holds it. */
  text: string;
  url: string;
  /** What « Copier » puts in the clipboard: the link, or the whole message (a group order's invitation). */
  copy?: "link" | "message";
}) {
  const t = useTranslations("Share");
  const titleId = useId();
  const fieldId = useId();
  const touch = useCoarsePointer();
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const links = shareLinks({ text, url });
  const copyValue = copy === "message" ? (text.includes(url) ? text : `${text} ${url}`) : url;

  useEffect(() => {
    setCanShare(typeof navigator.share === "function");
  }, []);
  // Each opening starts clean.
  useEffect(() => {
    if (!open) return;
    setCopied(false);
    setFailed(false);
  }, [open]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    if (failed) field.current?.select();
  }, [failed]);

  async function copyIt() {
    try {
      await navigator.clipboard.writeText(copyValue);
      setFailed(false);
      setCopied(true);
    } catch {
      setCopied(false);
      setFailed(true);
      field.current?.select();
    }
  }

  async function more() {
    try {
      await navigator.share(text.includes(url) ? { title, text } : { title, text, url });
      onClose();
    } catch (error) {
      // She closed the share menu: nothing to say. Anything else: the text to copy by hand.
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFailed(true);
    }
  }

  const copyLabel = copy === "message" ? t("copyMessage") : t("copy");
  const apps: { key: Exclude<Choice, "copy" | "more">; href: string; blank?: boolean }[] = [
    { key: "whatsapp", href: links.whatsapp, blank: true },
    { key: "sms", href: links.sms },
    { key: "email", href: links.email },
    ...(touch ? [{ key: "messenger" as const, href: links.messenger }] : []),
  ];

  return (
    <Sheet open={open} onClose={onClose} labelledBy={titleId} closeLabel={t("close")} hint={t("closeHint")} fit>
      <div className="flex flex-col gap-space-2-5">
        <div className="flex flex-col gap-space-0-5">
          <h2 id={titleId} className="font-title text-heading">
            {t("title")}
          </h2>
          <p className="line-clamp-2 text-sm break-words text-ink-muted">{title}</p>
        </div>
        <ul aria-label={t("choices")} className="flex flex-col gap-space-2">
          <li className="flex flex-col">
            <button type="button" onClick={() => void copyIt()} className={choiceClass}>
              <span aria-hidden="true" className={iconClass}>
                <ChoiceIcon name="copy" />
              </span>
              {copied ? t("copied") : copyLabel}
            </button>
          </li>
          {apps.map((app) => (
            <li key={app.key} className="flex flex-col">
              <a
                href={app.href}
                {...(app.blank ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className={choiceClass}
              >
                <span aria-hidden="true" className={iconClass}>
                  <ChoiceIcon name={app.key} />
                </span>
                {t(app.key)}
              </a>
            </li>
          ))}
          {canShare && (
            <li className="flex flex-col">
              <button type="button" onClick={() => void more()} className={choiceClass}>
                <span aria-hidden="true" className={iconClass}>
                  <ChoiceIcon name="more" />
                </span>
                {t("more")}
              </button>
            </li>
          )}
        </ul>
        <span role="status" className="sr-only">
          {copied ? t("copied") : ""}
        </span>
        {failed && (
          <div className="flex flex-col gap-space-1">
            <label htmlFor={fieldId} className="text-sm text-ink-muted">
              {t("copyFailed")}
            </label>
            <textarea
              ref={field}
              id={fieldId}
              readOnly
              rows={3}
              value={copyValue}
              onFocus={(event) => event.currentTarget.select()}
              className={`${inputClass} resize-none break-all text-sm field-sizing-content`}
            />
          </div>
        )}
      </div>
    </Sheet>
  );
}
