"use client";

import type { WishlistSettings, WishlistView } from "@closyria/shared";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { requestAccountPrompt } from "@/lib/account-prompt-request";
import { absoluteShareUrl } from "@/lib/share-link";
import { pushUndo } from "@/lib/undo";
import { fetchShareLink, patchWishlistSettings, shareWishlist, unshareWishlist } from "@/lib/wardrobe-client";
import { Dialog } from "./dialog";
import { buttonClass, focusRing, inputClass, primaryButtonClass } from "./ui";

const touch = "min-h-touch-target";

/** The four settings, in the order she reads them (spec §4.2). */
const SETTINGS = ["allowOpinions", "showOwnerName", "showOwnerOpinions", "showBudget"] as const;
type Setting = (typeof SETTINGS)[number];

/** The kept link: read from the API while the list is shared; `legacy`, shared before links were kept. */
type Link = { status: "loading" } | { status: "error" } | { status: "ready"; url: string | null; legacy: boolean };

/**
 * « Partage » for one list (spec §4.2): the link, always shown while the list is shared (Copier, Envoyer…, Changer le
 * lien), what friends see and the four settings that change it, saved at once, and « Arrêter le partage ».
 */
export function SharePanel({ list, onChange }: { list: WishlistView; onChange: (list: WishlistView) => void }) {
  const t = useTranslations("Lists.share");
  const locale = useLocale();
  const [link, setLink] = useState<Link>({ status: "loading" });
  const [message, setMessage] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // The browser's share menu (phones mostly): known only in the browser.
  const [canShare, setCanShare] = useState(false);
  // A setting being saved shows its new value until the API answers; it goes back if the save fails.
  const [pending, setPending] = useState<Partial<WishlistSettings>>({});
  const field = useRef<HTMLTextAreaElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  // After « Créer le lien », the button she pressed is gone: the focus goes to « Copier le lien » once it shows.
  const [focusCopy, setFocusCopy] = useState(false);
  // The list as last rendered: a save that answers late changes only its own setting on it, never the others.
  const latest = useRef(list);
  latest.current = list;
  const fieldId = useId();

  useEffect(() => {
    setCanShare(typeof navigator.share === "function");
  }, []);

  // The link again whenever it may have changed (shared, changed from another device): `sharedAt` moves with it.
  const { id, shared, sharedAt } = list;
  useEffect(() => {
    if (!shared || !sharedAt) return;
    let live = true;
    setLink((previous) => (previous.status === "ready" ? previous : { status: "loading" }));
    void fetchShareLink(id).then((result) => {
      if (!live) return;
      setLink(
        result.ok
          ? {
              status: "ready",
              url: result.url ? absoluteShareUrl(window.location.origin, result.url) : null,
              legacy: result.legacy,
            }
          : { status: "error" },
      );
    });
    return () => {
      live = false;
    };
  }, [id, shared, sharedAt]);

  const value = (key: Setting): boolean => pending[key] ?? list[key];
  const url = link.status === "ready" ? link.url : null;
  const legacy = link.status === "ready" && link.legacy;

  useEffect(() => {
    if (!focusCopy || !url) return;
    copyButton.current?.focus();
    setFocusCopy(false);
  }, [focusCopy, url]);

  /** Shares the list, or makes a new link (the old one stops working). */
  async function share() {
    setBusy(true);
    setMessage(null);
    const renewing = list.shared;
    const wasLegacy = legacy;
    const result = await shareWishlist(list.id);
    setBusy(false);
    setConfirming(false);
    if (!result.ok) return setMessage({ text: t("failed"), kind: "error" });
    setLink({ status: "ready", url: absoluteShareUrl(window.location.origin, result.url), legacy: false });
    if (renewing) setMessage({ text: t("renewed"), kind: "info" });
    if (wasLegacy) setFocusCopy(true);
    onChange({ ...list, shared: true, sharedAt: new Date().toISOString() });
    if (!renewing) void requestAccountPrompt("share");
  }

  async function copy() {
    if (!url) return;
    setMessage(null);
    try {
      await navigator.clipboard.writeText(url);
      setMessage({ text: t("copied"), kind: "info" });
    } catch {
      field.current?.select();
      setMessage({ text: t("copyFailed"), kind: "error" });
    }
  }

  async function send() {
    if (!url) return;
    setMessage(null);
    try {
      await navigator.share({ title: list.name, url });
    } catch (error) {
      // Closed without sending: nothing to say. Anything else: the link is selected, to copy by hand.
      if (error instanceof DOMException && error.name === "AbortError") return;
      field.current?.select();
      setMessage({ text: t("copyFailed"), kind: "error" });
    }
  }

  async function stop() {
    setBusy(true);
    const result = await unshareWishlist(list.id);
    setBusy(false);
    if (!result.ok) return setMessage({ text: t("failed"), kind: "error" });
    setLink({ status: "loading" });
    setMessage(null);
    onChange({ ...list, shared: false, sharedAt: null });
    pushUndo(t("stopped"), null);
  }

  async function toggle(key: Setting) {
    if (pending[key] !== undefined) return;
    const next = !list[key];
    setMessage(null);
    setPending((previous) => ({ ...previous, [key]: next }));
    const result = await patchWishlistSettings(list.id, { [key]: next });
    setPending(({ [key]: _done, ...rest }) => rest);
    if (!result.ok) return setMessage({ text: t("settingFailed"), kind: "error" });
    // Only this setting: another one saved meanwhile may have answered first, and this answer predates it.
    onChange({ ...latest.current, [key]: result[key] });
  }

  const since = list.sharedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(list.sharedAt))
    : null;
  const sees = [
    value("showOwnerName") && t("sees.name"),
    value("showOwnerOpinions") && t("sees.opinions"),
    value("showBudget") && t("sees.budget"),
  ].filter((thing): thing is string => Boolean(thing));

  return (
    <section
      aria-labelledby={`${fieldId}-title`}
      className="flex flex-col gap-space-4 rounded-card border border-line bg-surface-raised p-space-4"
    >
      <div className="flex flex-col gap-space-1">
        <h2 id={`${fieldId}-title`} className="font-display text-lead font-strong">
          {t("title")}
        </h2>
        <p className="text-sm">{list.shared ? (since ? t("sharedSince", { date: since }) : "") : t("notShared")}</p>
      </div>

      {list.shared && link.status === "loading" && (
        <p role="status" className="text-sm text-ink-muted">
          {t("linkLoading")}
        </p>
      )}
      {list.shared && link.status === "error" && (
        <p role="alert" className="text-sm text-danger">
          {t("linkError")}
        </p>
      )}
      {list.shared && url && (
        <div className="flex flex-col gap-space-2">
          <label htmlFor={fieldId} className="text-sm font-strong">
            {t("linkLabel")}
          </label>
          <textarea
            id={fieldId}
            ref={field}
            readOnly
            rows={2}
            value={url}
            onFocus={(event) => event.currentTarget.select()}
            className={`${inputClass} resize-none break-all border-dashed border-selected-line text-sm field-sizing-content`}
          />
          <div className="flex flex-wrap gap-space-2">
            <button
              ref={copyButton}
              type="button"
              onClick={() => void copy()}
              className={`${primaryButtonClass} ${touch}`}
            >
              {t("copy")}
            </button>
            {canShare && (
              <button type="button" onClick={() => void send()} className={`${buttonClass} ${touch}`}>
                {t("send")}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(true)}
              className={`${buttonClass} ${touch}`}
            >
              {t("renew")}
            </button>
          </div>
        </div>
      )}
      {list.shared && legacy && (
        <div className="flex flex-col items-start gap-space-2">
          <p className="text-sm">{t("legacy")}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(true)}
            className={`${primaryButtonClass} ${touch}`}
          >
            {t("keep")}
          </button>
        </div>
      )}
      {!list.shared && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void share()}
          className={`${primaryButtonClass} ${touch} self-start`}
        >
          {t("action")}
        </button>
      )}
      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`text-sm ${message.kind === "error" ? "text-danger" : "text-ink"}`}
        >
          {message.text}
        </p>
      )}

      <div className="flex flex-col gap-space-1 border-t border-line pt-space-3">
        <h3 className="text-sm font-strong">{t("settingsLabel")}</h3>
        <div className="flex max-w-measure flex-col gap-space-1 text-sm text-ink-muted">
          <p>{t("intro")}</p>
          {sees.length > 0 && (
            <p>{t("alsoSees", { things: new Intl.ListFormat(locale, { type: "conjunction" }).format(sees) })}</p>
          )}
          <p>{value("allowOpinions") ? t("opinionsOpen") : t("opinionsClosed")}</p>
          <p>{t("never")}</p>
        </div>
        <ul className="mt-space-2 flex max-w-narrow flex-col">
          {SETTINGS.map((key) => (
            <li key={key}>
              <Switch label={t(`settings.${key}`)} on={value(key)} onToggle={() => void toggle(key)} />
            </li>
          ))}
        </ul>
      </div>

      {list.shared && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void stop()}
          className={`${buttonClass} ${touch} self-start`}
        >
          {t("stop")}
        </button>
      )}

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={legacy ? t("keepTitle") : t("renewTitle")}
        closeLabel={t("close")}
      >
        <p className="text-ink-muted">{t("confirmBody")}</p>
        <div className="flex flex-wrap gap-space-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void share()}
            className={`${primaryButtonClass} ${touch}`}
          >
            {legacy ? t("keepConfirm") : t("renew")}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className={`${buttonClass} ${touch}`}>
            {t("cancel")}
          </button>
        </div>
      </Dialog>
    </section>
  );
}

/** An on / off setting: the whole row is the switch, its label its name. */
function Switch({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={`flex w-full items-center justify-between gap-space-3 rounded-button py-space-1 text-left text-sm text-ink ${touch} ${focusRing}`}
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={`relative h-space-5 w-space-7 shrink-0 rounded-full transition-colors duration-fast ${on ? "bg-accent" : "bg-ink-muted"}`}
      >
        <span
          className={`absolute top-space-1 left-space-1 size-space-4 rounded-full transition-transform duration-fast ${on ? "translate-x-space-5 bg-accent-ink" : "bg-surface-raised"}`}
        />
      </span>
    </button>
  );
}
