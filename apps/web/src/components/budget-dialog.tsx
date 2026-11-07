"use client";

import { type BudgetPeriod, type BudgetView, budgetPeriodSchema } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";
import { type BudgetForm, budgetFormOf, budgetInputFrom } from "@/lib/budget";
import { type BudgetScope, deleteBudget, resetBudget, saveBudget } from "@/lib/wardrobe-client";
import { Dialog } from "./dialog";
import { buttonClass, inputClass, primaryButtonClass } from "./ui";

const touch = "min-h-touch-target";
const PERIODS: readonly BudgetPeriod[] = budgetPeriodSchema.options;

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  scope: BudgetScope;
  budget: BudgetView | null;
  /** The budget as it now is (null: deleted); the window closes. */
  onChanged: (budget: BudgetView | null) => void;
};

/** « Budget »: amount in euros, period, dates for « Dates au choix »; delete it, or start a plain one again (§3.7). */
export function BudgetDialog({ open, onClose, title, scope, budget, onChanged }: Props) {
  const t = useTranslations("OrderDraft.dialog");
  return (
    <Dialog open={open} onClose={onClose} title={title} closeLabel={t("close")}>
      <BudgetFields scope={scope} budget={budget} onChanged={onChanged} />
    </Dialog>
  );
}

/** The budget out of a client answer (without its `ok` and `status`). */
function viewOf(result: Awaited<ReturnType<typeof saveBudget>>): { ok: true; view: BudgetView } | { ok: false } {
  if (!result.ok) return { ok: false };
  const { ok: _ok, status: _status, ...view } = result;
  return { ok: true, view };
}

/** Mounted each time the window opens, so it starts from the saved budget. */
function BudgetFields({ scope, budget, onChanged }: Pick<Props, "scope" | "budget" | "onChanged">) {
  const t = useTranslations("OrderDraft.dialog");
  const [form, setForm] = useState<BudgetForm>(() => budgetFormOf(budget));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const amountId = useId();
  const fromId = useId();
  const toId = useId();
  const errorId = useId();
  const set = (patch: Partial<BudgetForm>) => setForm((previous) => ({ ...previous, ...patch }));

  async function run(action: () => Promise<{ ok: true; view: BudgetView | null } | { ok: false }>) {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (!result.ok) return setError(t("failed"));
    onChanged(result.view);
  }

  function save(event: FormEvent) {
    event.preventDefault();
    const parsed = budgetInputFrom(form);
    if (!parsed.ok) return setError(t(parsed.error === "amount" ? "amountError" : "datesError"));
    setError(null);
    void run(async () => {
      return viewOf(await saveBudget(scope, parsed.input));
    });
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-space-4" noValidate>
      <div className="flex flex-col gap-space-1">
        <label htmlFor={amountId} className="text-sm font-strong">
          {t("amount")}
        </label>
        <input
          id={amountId}
          inputMode="decimal"
          autoComplete="off"
          value={form.amount}
          onChange={(event) => set({ amount: event.target.value })}
          aria-describedby={error ? errorId : undefined}
          className={`${inputClass} ${touch}`}
        />
      </div>
      <fieldset className="flex flex-col gap-space-2">
        <legend className="mb-space-2 text-sm font-strong">{t("period")}</legend>
        <div className="flex flex-wrap gap-space-2">
          {PERIODS.map((period) => (
            <label
              key={period}
              className={`${buttonClass} ${touch} cursor-pointer has-checked:border-accent has-checked:bg-hint has-checked:font-strong has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring has-focus-visible:outline-solid`}
            >
              <input
                type="radio"
                name="period"
                value={period}
                checked={form.period === period}
                onChange={() => set({ period })}
                className="accent-accent"
              />
              {t(`periods.${period}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {form.period === "custom" && (
        <div className="flex flex-wrap gap-space-3">
          <div className="flex flex-1 flex-col gap-space-1">
            <label htmlFor={fromId} className="text-sm font-strong">
              {t("from")}
            </label>
            <input
              id={fromId}
              type="date"
              value={form.startsOn}
              onChange={(event) => set({ startsOn: event.target.value })}
              className={`${inputClass} ${touch}`}
            />
          </div>
          <div className="flex flex-1 flex-col gap-space-1">
            <label htmlFor={toId} className="text-sm font-strong">
              {t("to")}
            </label>
            <input
              id={toId}
              type="date"
              value={form.endsOn}
              min={form.startsOn || undefined}
              onChange={(event) => set({ endsOn: event.target.value })}
              className={`${inputClass} ${touch}`}
            />
          </div>
        </div>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-space-2">
        <button type="submit" disabled={busy} className={`${primaryButtonClass} ${touch}`}>
          {t("save")}
        </button>
        {budget?.period === "none" && (
          <button
            type="button"
            disabled={busy}
            className={`${buttonClass} ${touch}`}
            onClick={() =>
              void run(async () => {
                return viewOf(await resetBudget(scope));
              })
            }
          >
            {t("reset")}
          </button>
        )}
        {budget && (
          <button
            type="button"
            disabled={busy}
            className={`${buttonClass} ${touch}`}
            onClick={() =>
              void run(async () => {
                const result = await deleteBudget(scope);
                return result.ok ? { ok: true, view: null } : { ok: false };
              })
            }
          >
            {t("delete")}
          </button>
        )}
      </div>
      {budget?.period === "none" && <p className="text-sm text-ink-muted">{t("resetHelp")}</p>}
    </form>
  );
}
