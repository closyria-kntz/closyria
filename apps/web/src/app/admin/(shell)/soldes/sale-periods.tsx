"use client";

import { MAX_SALE_PERIOD_NAME, type SalePeriod } from "@closyria/shared";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { adminRequest } from "@/lib/admin-catalog";
import { buttonClass, inputClass, primaryButtonClass } from "../../ui";
import { type Draft, draftError, EMPTY_DRAFT as EMPTY, type Phase, periodPhase } from "./rules";

const PHASE_CLASS: Record<Phase, string> = {
  current: "bg-success-soft text-success",
  upcoming: "bg-surface-sunken text-ink",
  past: "bg-surface-sunken text-ink-muted",
};

/** The periods, each edited or deleted in place, and the form that adds one (or edits the one chosen). */
export function SalePeriods({ periods, today }: { periods: SalePeriod[]; today: string }) {
  const t = useTranslations("Admin.sales");
  const errors = useTranslations("Admin.common.errors");
  const format = useFormatter();
  const router = useRouter();
  const [editing, setEditing] = useState<SalePeriod | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const base = "/api/admin/sale-periods";
  // The days are calendar days: read at noon UTC, they stay the same day in Paris.
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Europe/Paris",
    });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setMessage(null);
    const refused = draftError(draft);
    if (refused) return setMessage({ text: t(refused), failed: true });
    setBusy(true);
    const body = { name: draft.name.trim(), startsOn: draft.startsOn, endsOn: draft.endsOn };
    const res = editing
      ? await adminRequest("PATCH", `${base}/${editing.id}`, body)
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
    if (editing?.id === id) {
      setEditing(null);
      setDraft(EMPTY);
    }
    setMessage({ text: t("removed"), failed: false });
    router.refresh();
  };

  const startEdit = (period: SalePeriod) => {
    setEditing(period);
    setRemoving(null);
    setMessage(null);
    setDraft({ name: period.name, startsOn: period.startsOn, endsOn: period.endsOn });
  };

  const field = "flex flex-col gap-space-1 text-sm";
  const formTitle = editing ? t("formEdit", { name: editing.name }) : t("formAdd");
  return (
    <>
      <section
        aria-labelledby="sales-list-title"
        className="flex flex-col gap-space-3 rounded-card border border-card-border bg-card-bg p-space-4"
      >
        <h2 id="sales-list-title" className="font-display text-lead font-strong">
          {t("listTitle")}
        </h2>
        {periods.length === 0 ? (
          <p className="text-ink-muted">{t("none")}</p>
        ) : (
          <ul className="flex flex-col gap-space-2">
            {periods.map((period) => {
              const phase = periodPhase(period, today);
              return (
                <li
                  key={period.id}
                  className="flex flex-col gap-space-2 rounded-card border border-line p-space-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex flex-col gap-space-1">
                    <span className="flex flex-wrap items-center gap-space-2">
                      <span className="font-strong">{period.name}</span>
                      <span
                        className={`rounded-full px-space-2 py-space-0-5 text-caption font-strong ${PHASE_CLASS[phase]}`}
                      >
                        {t(phase)}
                      </span>
                    </span>
                    <span className="text-sm text-ink-muted">
                      {period.startsOn === period.endsOn
                        ? t("oneDay", { start: day(period.startsOn) })
                        : t("dates", { start: day(period.startsOn), end: day(period.endsOn) })}
                    </span>
                  </div>
                  {removing === period.id ? (
                    <div
                      role="alertdialog"
                      aria-label={t("confirmRemove", { name: period.name })}
                      className="flex flex-col gap-space-2 sm:max-w-sm"
                    >
                      <p>{t("confirmRemove", { name: period.name })}</p>
                      <div className="flex flex-wrap gap-space-2">
                        <button
                          type="button"
                          className={primaryButtonClass}
                          aria-disabled={busy}
                          onClick={() => remove(period.id)}
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
                      <button
                        type="button"
                        className={buttonClass}
                        aria-label={t("editLabel", { name: period.name })}
                        onClick={() => startEdit(period)}
                      >
                        {t("edit")}
                      </button>
                      <button
                        type="button"
                        className={buttonClass}
                        aria-label={t("removeLabel", { name: period.name })}
                        onClick={() => setRemoving(period.id)}
                      >
                        {t("remove")}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="sales-form-title"
        className="flex flex-col gap-space-3 rounded-card border border-card-border bg-card-bg p-space-4"
      >
        <h2 id="sales-form-title" className="font-display text-lead font-strong">
          {formTitle}
        </h2>
        <form
          aria-labelledby="sales-form-title"
          onSubmit={submit}
          noValidate
          className="grid grid-cols-1 gap-space-3 sm:grid-cols-3"
        >
          <label className={field}>
            {t("name")}
            <input
              required
              maxLength={MAX_SALE_PERIOD_NAME}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className={inputClass}
              aria-describedby="sale-name-hint"
            />
            <span id="sale-name-hint" className="text-ink-muted">
              {t("nameHint")}
            </span>
          </label>
          <label className={field}>
            {t("startsOn")}
            <input
              required
              type="date"
              value={draft.startsOn}
              onChange={(e) => setDraft({ ...draft, startsOn: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className={field}>
            {t("endsOn")}
            <input
              required
              type="date"
              min={draft.startsOn || undefined}
              value={draft.endsOn}
              onChange={(e) => setDraft({ ...draft, endsOn: e.target.value })}
              className={inputClass}
            />
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
                  setMessage(null);
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
      </section>
    </>
  );
}
