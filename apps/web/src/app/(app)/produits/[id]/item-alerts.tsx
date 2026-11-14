"use client";

import type { ItemView } from "@closyria/shared";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { Switch } from "@/components/switch";
import { blockClass, blockTitleClass, buttonClass, focusRing, inputClass } from "@/components/ui";
import { formatAmount } from "@/lib/budget";
import { parsePriceCents } from "@/lib/price";
import { useAccount } from "@/lib/profile-context";
import { fetchDevices } from "@/lib/push";
import { relativeDate } from "@/lib/relative-date";
import { pushUndo } from "@/lib/undo";
import { patchItem, undoWith } from "@/lib/wardrobe-client";

const touch = "min-h-touch-target";
const linkClass = `inline-flex ${touch} items-center self-start rounded-button text-sm font-strong text-accent underline underline-offset-4 ${focusRing}`;
const NOTIFICATIONS = "/reglages/notifications";

/** A target as she would type it: « 60 », « 59,90 ». */
function toEuros(cents: number | null): string {
  if (cents === null) return "";
  return (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)).replace(".", ",");
}

/** Whether she would be told on a device: an account with at least one; null while it is read. */
function useCanBeNotified(): boolean | null {
  const account = useAccount();
  const [devices, setDevices] = useState<number | null>(null);
  // `useAccount` gives a new object each time: the e-mail says who she is.
  const email = account === null ? undefined : account.email;
  useEffect(() => {
    if (!email) return;
    let alive = true;
    fetchDevices().then(
      (found) => alive && setDevices(found.length),
      // Unknown: no link rather than a wrong one.
      () => alive && setDevices(1),
    );
    return () => {
      alive = false;
    };
  }, [email]);
  if (email === undefined) return null;
  if (email === null) return false;
  return devices === null ? null : devices > 0;
}

/**
 * « Alertes » on the sheet of one of her wishes (chantier 4, spec §3.3): « M'alerter » (on by default), « Préviens-moi
 * sous … € » (optional) and where the watch stands (« Suivi : taille M · vérifié il y a 12 min », « Suivi en pause »,
 * « Suivi impossible pour cette boutique »). Not shown for an item that is no longer a wish (`alertState` null).
 */
export function ItemAlerts({
  item,
  onChange,
  reload,
}: {
  item: ItemView;
  onChange: (item: ItemView) => void;
  reload: () => Promise<void>;
}) {
  const t = useTranslations("Item.alerts");
  const locale = useLocale();
  const currency = item.product.currency ?? "EUR";
  const money = (cents: number) => formatAmount(locale, cents, currency);
  const [target, setTarget] = useState(toEuros(item.targetPriceCents));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canBeNotified = useCanBeNotified();
  const fieldId = useId();
  const hintId = useId();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => setTarget(toEuros(item.targetPriceCents)), [item.targetPriceCents]);
  // « vérifié il y a … » stays true while the sheet is open.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (item.alertState === null) return null;

  async function save(patch: { alertsEnabled?: boolean; targetPriceCents?: number | null }, toast: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await patchItem(item.id, patch);
      if (!result.ok) {
        setError(t("saveFailed"));
        return;
      }
      onChange(result.item);
      pushUndo(toast, undoWith(result.undo, reload));
    } finally {
      setBusy(false);
    }
  }

  const toggle = () =>
    void save({ alertsEnabled: !item.alertsEnabled }, t(item.alertsEnabled ? "toast.off" : "toast.on"));

  const saveTarget = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = parsePriceCents(target);
    if (!parsed.ok || parsed.cents === 0) {
      setError(t("targetInvalid"));
      return;
    }
    const cents = parsed.cents ?? null;
    if (cents === item.targetPriceCents) return;
    void save(
      { targetPriceCents: cents },
      cents === null ? t("toast.targetCleared") : t("toast.target", { price: money(cents) }),
    );
  };

  const sizes = item.watchedSizes;
  const what =
    sizes === "any"
      ? t("any")
      : sizes.length === 1
        ? t("size", { size: sizes[0] ?? "" })
        : t("sizes", { sizes: sizes.join(t("sizesJoin")) });
  const checked = item.checkedAt ? t("checked", { when: relativeDate(item.checkedAt, now, locale) }) : t("notChecked");

  return (
    <section aria-labelledby="alerts-title" aria-busy={busy || undefined} data-block className={blockClass}>
      <h2 id="alerts-title" className={blockTitleClass}>
        {t("title")}
      </h2>

      <div data-testid="alert-line" className="flex flex-col gap-space-1">
        {item.alertState === "watching" ? (
          <p className="text-sm font-strong">
            <span aria-hidden="true">🔔 </span>
            {t("watching", { what, checked })}
          </p>
        ) : item.alertState === "paused" ? (
          <>
            <p className="text-sm font-strong">
              <span aria-hidden="true">⏸️ </span>
              {t("paused")}
            </p>
            {item.alertsEnabled ? (
              <p className="text-sm text-ink-muted">
                {t("pausedSettings")}{" "}
                <Link href={NOTIFICATIONS} className={`rounded-button underline underline-offset-4 ${focusRing}`}>
                  {t("pausedSettingsLink")}
                </Link>
              </p>
            ) : (
              <p className="text-sm text-ink-muted">{t("pausedItem")}</p>
            )}
          </>
        ) : (
          <>
            <p className="text-sm font-strong">{t("impossible")}</p>
            <p className="text-sm text-ink-muted">{t("impossibleHint")}</p>
          </>
        )}
        {item.alertState === "watching" && canBeNotified === false && (
          <Link href={NOTIFICATIONS} className={linkClass}>
            {t("enableLink")}
          </Link>
        )}
      </div>

      <Switch label={t("switch")} hint={t("switchHint")} on={item.alertsEnabled} onToggle={toggle} disabled={busy} />

      <form onSubmit={saveTarget} className="flex flex-col gap-space-2 border-t border-line pt-space-3">
        <label htmlFor={fieldId} className="text-sm font-strong">
          {t("target")}
        </label>
        <div className="flex flex-wrap items-center gap-space-2">
          <span className="flex items-center gap-space-2">
            <input
              id={fieldId}
              inputMode="decimal"
              autoComplete="off"
              size={8}
              value={target}
              aria-describedby={hintId}
              aria-invalid={error ? true : undefined}
              onChange={(event) => setTarget(event.target.value)}
              className={`${inputClass} ${touch} w-auto tabular-nums`}
            />
            <span aria-hidden="true">€</span>
          </span>
          <button type="submit" disabled={busy} className={`${buttonClass} ${touch}`}>
            {t("targetSave")}
          </button>
          {item.targetPriceCents !== null && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void save({ targetPriceCents: null }, t("toast.targetCleared"))}
              className={`${buttonClass} ${touch}`}
            >
              {t("targetClear")}
            </button>
          )}
        </div>
        <p id={hintId} className="text-sm text-ink-muted">
          {item.targetPriceCents !== null ? t("targetNow", { price: money(item.targetPriceCents) }) : t("targetHint")}
        </p>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
