"use client";

import type { ListingManageView } from "@closyria/shared";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { buttonClass, focusRing, primaryButtonClass } from "@/components/ui";
import { type SendError, withdrawShop } from "@/lib/listing";

/**
 * The shop's status, and the withdrawal in two steps (« Retirer ma boutique de Closyria », then « Oui, retirer ma
 * boutique »): immediate, then confirmed in place.
 */
export function WithdrawPanel({ token, initial }: { token: string; initial: ListingManageView }) {
  const t = useTranslations("Listing");
  const format = useFormatter();
  const [view, setView] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SendError | null>(null);
  const [justDone, setJustDone] = useState(false);
  const status = useRef<HTMLParagraphElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (justDone) status.current?.focus();
  }, [justDone]);
  useEffect(() => {
    if (confirming) confirmButton.current?.focus();
  }, [confirming]);
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "long", timeZone: "Europe/Paris" });

  const withdraw = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await withdrawShop(token);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setView(result.data);
    setConfirming(false);
    setJustDone(true);
  };

  if (view.withdrawnAt) {
    return (
      <div className="flex flex-col gap-space-3">
        <p
          ref={status}
          tabIndex={-1}
          role="status"
          data-testid="listing-withdrawn"
          className="rounded-card bg-surface-sunken p-space-4 font-strong"
        >
          {justDone
            ? t("manage.done", { shop: view.shopName })
            : t("manage.withdrawn", { shop: view.shopName, date: day(view.withdrawnAt) })}
        </p>
        <Link href="/referencer-ma-boutique" className={`self-start text-accent underline ${focusRing}`}>
          {t("invalid.request")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-space-4">
      <p className="rounded-card bg-une p-space-4 font-strong">
        {t("manage.active", { date: day(view.acceptedAt), version: view.conditionsVersion })}
      </p>
      <p className="text-ink-muted">{t("manage.withdrawHint")}</p>
      {confirming ? (
        <section
          aria-labelledby="withdraw-confirm"
          className="flex flex-col gap-space-3 rounded-card border border-line bg-surface-raised p-space-4"
        >
          <h2 id="withdraw-confirm" className="font-title text-section-title font-regular">
            {t("manage.confirmTitle", { shop: view.shopName })}
          </h2>
          <p>{t("manage.confirmBody")}</p>
          <div className="flex flex-wrap gap-space-3">
            <button
              ref={confirmButton}
              type="button"
              onClick={() => void withdraw()}
              disabled={busy}
              className={`${primaryButtonClass} min-h-touch-target`}
            >
              {busy ? t("busy") : t("manage.confirm")}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className={`${buttonClass} min-h-touch-target`}
            >
              {t("manage.cancel")}
            </button>
          </div>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={`${buttonClass} min-h-touch-target self-start`}
        >
          {t("manage.withdraw")}
        </button>
      )}
      <p role="alert" className="text-danger empty:hidden">
        {error === "invalid" ? t("manage.invalidTitle") : error ? t(`errors.${error}`) : ""}
      </p>
    </div>
  );
}
