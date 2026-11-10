"use client";

import type { ShippingOption } from "@closyria/shared";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { adminRequest } from "@/lib/admin-catalog";
import { buttonClass, inputClass, primaryButtonClass } from "../../../ui";

/** "6,90" or "6.90" in euros to cents; null when it is not a plain amount. */
export function eurosToCents(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

const centsToEuros = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

type Draft = { label: string; shipping: string; freeFrom: string };
const EMPTY: Draft = { label: "", shipping: "", freeFrom: "" };

/** The « Livraison » section of a shop: its delivery options, added, edited and deleted one by one. */
export function ShippingOptions({ shopId, options }: { shopId: string; options: ShippingOption[] }) {
  const t = useTranslations("Admin.shipping");
  const errors = useTranslations("Admin.common.errors");
  const format = useFormatter();
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const base = `/api/admin/shops/${shopId}/shipping-options`;
  const money = (cents: number) => format.number(cents / 100, { style: "currency", currency: "EUR" });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setMessage(null);
    const shippingCents = eurosToCents(draft.shipping);
    if (shippingCents === null) return setMessage({ text: t("invalidAmount"), failed: true });
    let freeFromCents: number | null = null;
    if (draft.freeFrom.trim() !== "") {
      freeFromCents = eurosToCents(draft.freeFrom);
      if (freeFromCents === null) return setMessage({ text: t("invalidAmount"), failed: true });
      if (freeFromCents <= 0) return setMessage({ text: t("invalidThreshold"), failed: true });
    }
    setBusy(true);
    const body = { label: draft.label.trim(), shippingCents, freeFromCents };
    const res = editing
      ? await adminRequest("PATCH", `${base}/${editing}`, body)
      : await adminRequest("POST", base, body);
    setBusy(false);
    if (!res.ok) return setMessage({ text: errors("generic"), failed: true });
    setMessage({ text: t("saved"), failed: false });
    setEditing(null);
    setDraft(EMPTY);
    router.refresh();
  };

  const remove = async (id: string) => {
    if (busy) return;
    setBusy(true);
    const res = await adminRequest("DELETE", `${base}/${id}`);
    setBusy(false);
    setRemoving(null);
    if (!res.ok) return setMessage({ text: errors("generic"), failed: true });
    setMessage({ text: t("removed"), failed: false });
    router.refresh();
  };

  const startEdit = (o: ShippingOption) => {
    setEditing(o.id);
    setRemoving(null);
    setMessage(null);
    setDraft({
      label: o.label,
      shipping: centsToEuros(o.shippingCents),
      freeFrom: o.freeFromCents === null ? "" : centsToEuros(o.freeFromCents),
    });
  };

  const field = "flex flex-col gap-space-1 text-sm";
  return (
    <div className="flex flex-col gap-space-3">
      <p className="text-ink-muted">{t("intro")}</p>
      {options.length === 0 ? (
        <p>{t("none")}</p>
      ) : (
        <ul className="flex flex-col gap-space-2">
          {options.map((o) => (
            <li
              key={o.id}
              className="flex flex-col gap-space-2 rounded-card border border-line p-space-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-space-1">
                <span className="font-strong">{o.label}</span>
                <span className="text-sm text-ink-muted">
                  {o.freeFromCents === null
                    ? t("summaryNoThreshold", { port: money(o.shippingCents) })
                    : t("summary", { port: money(o.shippingCents), threshold: money(o.freeFromCents) })}
                </span>
              </div>
              {removing === o.id ? (
                <div
                  role="alertdialog"
                  aria-label={t("confirmRemove", { label: o.label })}
                  className="flex flex-col gap-space-2"
                >
                  <p>{t("confirmRemove", { label: o.label })}</p>
                  <div className="flex flex-wrap gap-space-2">
                    <button
                      type="button"
                      className={primaryButtonClass}
                      aria-disabled={busy}
                      onClick={() => remove(o.id)}
                    >
                      {t("confirmButton")}
                    </button>
                    <button type="button" className={buttonClass} onClick={() => setRemoving(null)}>
                      {t("cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-space-2">
                  <button type="button" className={buttonClass} onClick={() => startEdit(o)}>
                    {t("edit")}
                  </button>
                  <button type="button" className={buttonClass} onClick={() => setRemoving(o.id)}>
                    {t("remove")}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="grid grid-cols-1 gap-space-3 sm:grid-cols-3">
        <label className={field}>
          {t("label")}
          <input
            required
            maxLength={40}
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            className={inputClass}
          />
        </label>
        <label className={field}>
          {t("shippingPrice")}
          <input
            required
            inputMode="decimal"
            value={draft.shipping}
            onChange={(e) => setDraft({ ...draft, shipping: e.target.value })}
            className={inputClass}
          />
        </label>
        <label className={field}>
          {t("freeFrom")}
          <input
            inputMode="decimal"
            value={draft.freeFrom}
            onChange={(e) => setDraft({ ...draft, freeFrom: e.target.value })}
            className={inputClass}
            aria-describedby="free-from-hint"
          />
          <span id="free-from-hint" className="text-ink-muted">
            {t("freeFromHint")}
          </span>
        </label>
        <div className="flex flex-wrap gap-space-2 sm:col-span-3">
          <button type="submit" className={primaryButtonClass} aria-disabled={busy}>
            {editing ? t("save") : t("add")}
          </button>
          {editing ? (
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                setEditing(null);
                setDraft(EMPTY);
              }}
            >
              {t("cancel")}
            </button>
          ) : null}
        </div>
        <p
          role="status"
          aria-live="polite"
          className={`sm:col-span-3 ${message?.failed ? "text-danger" : "text-success"}`}
        >
          {message?.text}
        </p>
      </form>
    </div>
  );
}
