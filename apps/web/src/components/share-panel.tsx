"use client";

import type { WishlistView } from "@closyria/shared";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { requestAccountPrompt } from "@/lib/account-prompt-request";
import { absoluteShareUrl } from "@/lib/share-link";
import { pushUndo } from "@/lib/undo";
import { shareWishlist, unshareWishlist } from "@/lib/wardrobe-client";
import { buttonClass, inputClass, primaryButtonClass } from "./ui";

const touch = "min-h-touch-target";

/**
 * « Partager » for one list. The API shows the link only when it is made (only its hash is kept), so it is displayed
 * right then, with a copy button; sharing again makes a new link and ends the old one.
 */
export function SharePanel({ list, onChange }: { list: WishlistView; onChange: (list: WishlistView) => void }) {
  const t = useTranslations("Lists.share");
  const locale = useLocale();
  const [link, setLink] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const fieldId = useId();

  // The link just made is selected, ready to be copied by hand if the clipboard is out of reach.
  useEffect(() => {
    if (link) field.current?.select();
  }, [link]);

  async function share() {
    setBusy(true);
    setMessage(null);
    const result = await shareWishlist(list.id);
    setBusy(false);
    if (!result.ok) return setMessage({ text: t("failed"), kind: "error" });
    setLink(absoluteShareUrl(window.location.origin, result.url));
    setMessage({ text: t("created"), kind: "info" });
    onChange({ ...list, shared: true, sharedAt: new Date().toISOString() });
    void requestAccountPrompt("share");
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setMessage({ text: t("copied"), kind: "info" });
    } catch {
      field.current?.select();
      setMessage({ text: t("copyFailed"), kind: "error" });
    }
  }

  async function stop() {
    setBusy(true);
    const result = await unshareWishlist(list.id);
    setBusy(false);
    if (!result.ok) return setMessage({ text: t("failed"), kind: "error" });
    setLink(null);
    setMessage(null);
    onChange({ ...list, shared: false, sharedAt: null });
    pushUndo(t("stopped"), null);
  }

  const since = list.sharedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(list.sharedAt))
    : null;

  return (
    <section
      aria-labelledby={`${fieldId}-title`}
      className="flex flex-col gap-space-3 rounded-card border border-line bg-surface-raised p-space-4"
    >
      <h2 id={`${fieldId}-title`} className="font-display text-lead font-strong">
        {t("title")}
      </h2>
      <p className="max-w-measure text-sm text-ink-muted">{t("intro")}</p>
      <p className="text-sm">{list.shared ? (since ? t("sharedSince", { date: since }) : "") : t("notShared")}</p>
      {link && (
        <div className="flex flex-col gap-space-2">
          <label htmlFor={fieldId} className="text-sm font-strong">
            {t("linkLabel")}
          </label>
          <div className="flex flex-col gap-space-2 sm:flex-row">
            <input
              id={fieldId}
              ref={field}
              readOnly
              value={link}
              onFocus={(event) => event.currentTarget.select()}
              className={`${inputClass} ${touch}`}
            />
            <button type="button" onClick={() => void copy()} className={`${buttonClass} ${touch} justify-center`}>
              {t("copy")}
            </button>
          </div>
        </div>
      )}
      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`text-sm ${message.kind === "error" ? "text-danger" : "text-ink"}`}
        >
          {message.text}
        </p>
      )}
      {list.shared && <p className="max-w-measure text-sm text-ink-muted">{t("renewWarning")}</p>}
      <div className="flex flex-wrap gap-space-2">
        <button type="button" disabled={busy} onClick={() => void share()} className={`${primaryButtonClass} ${touch}`}>
          {t("action")}
        </button>
        {list.shared && (
          <button type="button" disabled={busy} onClick={() => void stop()} className={`${buttonClass} ${touch}`}>
            {t("stop")}
          </button>
        )}
      </div>
    </section>
  );
}
