"use client";

import type { WishlistView } from "@closyria/shared";
import NextLink from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { requestAccountPrompt } from "@/lib/account-prompt-request";
import { absoluteShareUrl } from "@/lib/share-link";
import { pushUndo } from "@/lib/undo";
import { fetchShareLink, patchWishlistSettings, shareWishlist, unshareWishlist } from "@/lib/wardrobe-client";
import { Dialog } from "./dialog";
import { groupOrderHref } from "./group-order-banner";
import { GroupOrderOpenDialog, type ListShop } from "./group-order-open-dialog";
import { ShareSheet } from "./share-sheet";
import { Switch } from "./switch";
import { buttonClass, inputClass, primaryButtonClass, textareaClass } from "./ui";

const touch = "min-h-touch-target";

/** The four settings, in the order she reads them (spec §4.2). */
const SETTINGS = ["allowOpinions", "showOwnerName", "showOwnerOpinions", "showBudget"] as const;
/** The four, and « Mes amies peuvent m'offrir des articles » (spec 2b § 4), after them. */
type Setting = (typeof SETTINGS)[number] | "allowGifts";
type Switches = Pick<WishlistView, Setting>;

/** The kept link: read from the API while the list is shared; `legacy`, shared before links were kept. */
type Link = { status: "loading" } | { status: "error" } | { status: "ready"; url: string | null; legacy: boolean };

/**
 * « Partage » for one list (spec §4.2): the link, always shown while the list is shared (« Partager », which opens the
 * share window of task 9 — copy, WhatsApp, SMS, e-mail… —, and « Changer le lien »), what friends see and the four settings that change it, saved at once, and « Arrêter le partage ».
 */
export function SharePanel({
  list,
  shops,
  onChange,
}: {
  list: WishlistView;
  /** The shops of the list's items: where a group order can be opened (spec 2c § 4.1). */
  shops: ListShop[];
  onChange: (list: WishlistView) => void;
}) {
  const t = useTranslations("Lists.share");
  const tGroup = useTranslations("GroupOrder.open");
  const [opening, setOpening] = useState(false);
  const locale = useLocale();
  const [link, setLink] = useState<Link>({ status: "loading" });
  const [message, setMessage] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [confirmingGiftsOff, setConfirmingGiftsOff] = useState(false);
  const [sending, setSending] = useState(false);
  // A setting being saved shows its new value until the API answers; it goes back if the save fails.
  const [pending, setPending] = useState<Partial<Switches>>({});
  const shareButton = useRef<HTMLButtonElement>(null);
  // After « Créer le lien », the button she pressed is gone: the focus goes to « Partager » once it shows.
  const [focusShare, setFocusShare] = useState(false);
  // The list as last rendered: a save that answers late changes only its own setting on it, never the others.
  const latest = useRef(list);
  latest.current = list;
  const fieldId = useId();

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
    if (!focusShare || !url) return;
    shareButton.current?.focus();
    setFocusShare(false);
  }, [focusShare, url]);

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
    if (wasLegacy) setFocusShare(true);
    onChange({ ...list, shared: true, sharedAt: new Date().toISOString() });
    if (!renewing) void requestAccountPrompt("share");
  }

  async function stop() {
    setBusy(true);
    const result = await unshareWishlist(list.id);
    setBusy(false);
    setConfirmingStop(false);
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
    onChange({
      ...latest.current,
      [key]: result[key],
      ...(key === "allowGifts" ? { giftReminderDue: result.giftReminderDue } : {}),
    });
  }

  /** Off: she is told first that her friends' gifts disappear from the link (they are kept for when she turns it back on). */
  function toggleGifts() {
    if (pending.allowGifts !== undefined) return;
    if (list.allowGifts) setConfirmingGiftsOff(true);
    else void toggle("allowGifts");
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
            readOnly
            rows={2}
            value={url}
            onFocus={(event) => event.currentTarget.select()}
            className={`${textareaClass} resize-none break-all border-dashed border-selected-line text-sm field-sizing-content`}
          />
          <div className="flex flex-wrap gap-space-2">
            <button
              ref={shareButton}
              type="button"
              onClick={() => setSending(true)}
              className={`${primaryButtonClass} ${touch}`}
            >
              {t("action")}
            </button>
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
          {value("allowGifts") && <p>{t("giftsOpen")}</p>}
          <p>{t("never")}</p>
        </div>
        <ul className="mt-space-2 flex max-w-narrow flex-col">
          {SETTINGS.map((key) => (
            <li key={key}>
              <Switch label={t(`settings.${key}`)} on={value(key)} onToggle={() => void toggle(key)} />
            </li>
          ))}
          <li>
            <Switch label={t("settings.allowGifts")} on={value("allowGifts")} onToggle={toggleGifts} />
          </li>
        </ul>
        {value("allowGifts") && <GiftFields list={list} latest={latest} onChange={onChange} />}
      </div>

      {list.shared && (
        <div className="flex flex-col items-start gap-space-2 border-t border-line pt-space-3">
          {list.groupOrder ? (
            <NextLink href={groupOrderHref(list.id)} className={`${primaryButtonClass} ${touch}`}>
              <span aria-hidden="true">🛍️&nbsp;</span>
              {tGroup("see")}
            </NextLink>
          ) : (
            shops.length > 0 && (
              <button type="button" onClick={() => setOpening(true)} className={`${buttonClass} ${touch}`}>
                <span aria-hidden="true">🛍️&nbsp;</span>
                {tGroup("action")}
              </button>
            )
          )}
        </div>
      )}

      {list.shared && (
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirmingStop(true)}
          className={`${buttonClass} ${touch} self-start`}
        >
          {t("stop")}
        </button>
      )}

      {list.shared && url && (
        <ShareSheet open={sending} onClose={() => setSending(false)} title={list.name} text={list.name} url={url} />
      )}
      {list.shared && !list.groupOrder && shops.length > 0 && (
        <GroupOrderOpenDialog open={opening} onClose={() => setOpening(false)} listId={list.id} shops={shops} />
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

      <Dialog
        open={confirmingStop}
        onClose={() => setConfirmingStop(false)}
        title={t("stopTitle")}
        closeLabel={t("close")}
      >
        <p className="text-ink-muted">{t("stopBody")}</p>
        {list.allowGifts && <p className="text-ink-muted">{t("giftsOffBody")}</p>}
        <div className="flex flex-wrap gap-space-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void stop()}
            className={`${primaryButtonClass} ${touch}`}
          >
            {t("stopConfirm")}
          </button>
          <button type="button" onClick={() => setConfirmingStop(false)} className={`${buttonClass} ${touch}`}>
            {t("cancel")}
          </button>
        </div>
      </Dialog>
      <Dialog
        open={confirmingGiftsOff}
        onClose={() => setConfirmingGiftsOff(false)}
        title={t("giftsOffTitle")}
        closeLabel={t("close")}
      >
        <p className="text-ink-muted">{t("giftsOffBody")}</p>
        <div className="flex flex-wrap gap-space-2">
          <button
            type="button"
            onClick={() => {
              setConfirmingGiftsOff(false);
              void toggle("allowGifts");
            }}
            className={`${primaryButtonClass} ${touch}`}
          >
            {t("giftsOffConfirm")}
          </button>
          <button type="button" onClick={() => setConfirmingGiftsOff(false)} className={`${buttonClass} ${touch}`}>
            {t("cancel")}
          </button>
        </div>
      </Dialog>
    </section>
  );
}

/**
 * The occasion and the date her friends see on the link (both optional). The occasion is saved when she leaves the
 * field (or presses Entrée), the date when she picks it; emptied, each is cleared.
 */
function GiftFields({
  list,
  latest,
  onChange,
}: {
  list: WishlistView;
  latest: { current: WishlistView };
  onChange: (list: WishlistView) => void;
}) {
  const t = useTranslations("Lists.share");
  const id = useId();
  const [occasion, setOccasion] = useState(list.giftOccasion ?? "");
  const [date, setDate] = useState(list.giftDate ?? "");
  const [error, setError] = useState<string | null>(null);
  // Changed elsewhere (another device, an undo): the fields follow.
  useEffect(() => setOccasion(list.giftOccasion ?? ""), [list.giftOccasion]);
  useEffect(() => setDate(list.giftDate ?? ""), [list.giftDate]);

  async function save(patch: { giftOccasion: string | null } | { giftDate: string | null }) {
    setError(null);
    const result = await patchWishlistSettings(list.id, patch);
    if (!result.ok) {
      setError(t(result.error === "invalid_request" && "giftOccasion" in patch ? "occasionInvalid" : "settingFailed"));
      return;
    }
    onChange({
      ...latest.current,
      giftOccasion: result.giftOccasion,
      giftDate: result.giftDate,
      giftReminderDue: result.giftReminderDue,
    });
  }

  function saveOccasion() {
    const next = occasion.trim() || null;
    if (next === list.giftOccasion) return;
    void save({ giftOccasion: next });
  }

  return (
    <div className="mt-space-2 flex max-w-narrow flex-col gap-space-2">
      <div className="grid grid-cols-1 gap-space-3 sm:grid-cols-3">
        <div className="flex min-w-space-0 flex-col gap-space-1 sm:col-span-2">
          <label htmlFor={`${id}-occasion`} className="text-sm font-strong">
            {t("occasion")}
          </label>
          <input
            id={`${id}-occasion`}
            value={occasion}
            placeholder={t("occasionPlaceholder")}
            aria-describedby={`${id}-hint`}
            enterKeyHint="done"
            onChange={(event) => setOccasion(event.target.value)}
            onBlur={saveOccasion}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                saveOccasion();
              }
            }}
            className={`${inputClass} ${touch}`}
          />
        </div>
        <div className="flex min-w-space-0 flex-col gap-space-1">
          <label htmlFor={`${id}-date`} className="text-sm font-strong">
            {t("date")}
          </label>
          <input
            id={`${id}-date`}
            type="date"
            value={date}
            aria-describedby={`${id}-hint`}
            onChange={(event) => {
              setDate(event.target.value);
              const next = event.target.value || null;
              if (next !== list.giftDate) void save({ giftDate: next });
            }}
            className={`${inputClass} ${touch}`}
          />
        </div>
      </div>
      <p id={`${id}-hint`} className="text-sm text-ink-muted">
        {t("giftHint")}
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
