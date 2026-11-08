"use client";

import type { BudgetView } from "@closyria/shared";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { budgetCardState, formatAmount } from "@/lib/budget";
import { type BudgetScope, fetchBudget } from "@/lib/wardrobe-client";
import { BudgetDialog } from "./budget-dialog";
import { dateOf } from "./order-draft";
import { buttonClass } from "./ui";

const touch = "min-h-touch-target";

type Loaded = { status: "loading" | "ready" | "error"; view: BudgetView | null };

/**
 * The budget under the title of « Mes envies »: what the budget is, what is already ordered, what is left (or by how
 * much it is passed), a bar in two colours (ordered / the order in progress) and its legend. A list without a budget
 * says so and offers to add one. `draftCents` is the total of the ticked wishes of the scope; `reloadKey` changes
 * when the page read its wishes again, so the budget is read again too.
 */
export function BudgetCard({
  scope,
  draftCents,
  listName,
  reloadKey = 0,
}: {
  scope: BudgetScope;
  draftCents: number;
  listName?: string | undefined;
  reloadKey?: number;
}) {
  const t = useTranslations("Views.budgetCard");
  const tBudget = useTranslations("OrderDraft.budget");
  const locale = useLocale();
  const [budget, setBudget] = useState<Loaded>({ status: "loading", view: null });
  const [dialogOpen, setDialogOpen] = useState(false);
  const titleId = useId();
  const generation = useRef(0);
  const scopeKey = JSON.stringify(scope);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scopeKey stands for scope.
  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const view = await fetchBudget(scope);
      if (mine === generation.current) setBudget({ status: "ready", view });
    } catch {
      if (mine === generation.current) setBudget((previous) => ({ status: "error", view: previous.view }));
    }
  }, [scopeKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey asks for another read.
  useEffect(() => {
    void load();
  }, [load, reloadKey]);
  // A list's tab starts from "loading" again, never from the previous list's budget.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scopeKey stands for scope.
  useEffect(() => {
    setBudget({ status: "loading", view: null });
  }, [scopeKey]);

  const view = budget.view;
  const state = budgetCardState(view, draftCents);
  // The two widths go through custom properties (no inline pixel in the markup).
  const bars = useRef<HTMLDivElement>(null);
  const spentPct = state.kind === "none" ? 0 : state.spentPct;
  const pickPct = state.kind === "none" ? 0 : state.pickPct;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the bars appear when the budget has been read.
  useEffect(() => {
    bars.current?.style.setProperty("--spent-width", `${spentPct}%`);
    bars.current?.style.setProperty("--pick-width", `${pickPct}%`);
  }, [spentPct, pickPct, budget.status]);

  const money = (cents: number) => formatAmount(locale, cents);
  const isList = "wishlistId" in scope;
  const dialogTitle = tBudget(isList ? "listTitle" : "profileTitle");

  const heading = (() => {
    if (!view) return "";
    const amount = money(view.amountCents);
    const dates = { start: dateOf(locale, view.startsOn), end: dateOf(locale, view.endsOn) };
    if (view.ended) return tBudget("ended", { ...dates, amount });
    if (view.period === "week") return tBudget("week", { amount });
    if (view.period === "month") return tBudget("month", { amount });
    if (view.period === "custom") return tBudget("custom", { ...dates, amount });
    return tBudget("plain", { amount });
  })();

  return (
    <section
      aria-labelledby={titleId}
      data-testid="budget-card"
      className="glass flex max-w-measure flex-col gap-space-2 rounded-card p-space-4 tabular-nums"
    >
      <h2 id={titleId} className="sr-only">
        {t("label")}
      </h2>
      {budget.status === "loading" && <p className="text-sm text-ink-muted">…</p>}
      {budget.status === "error" && <p className="text-sm text-danger">{t("loadError")}</p>}
      {budget.status === "ready" && state.kind === "none" && (
        <>
          <div className="flex flex-wrap items-center gap-x-space-4 gap-y-space-1">
            <p className="font-strong">{isList && listName ? t("noneList", { list: listName }) : t("noneProfile")}</p>
            <button type="button" className={`${buttonClass} ${touch}`} onClick={() => setDialogOpen(true)}>
              {t("add")}
            </button>
          </div>
          {isList && <p className="text-sm text-ink-muted">{t("listCountsAnyway")}</p>}
        </>
      )}
      {budget.status === "ready" && state.kind !== "none" && view && (
        <>
          <div className="flex flex-wrap items-baseline gap-x-space-4 gap-y-space-1">
            <p className="font-strong">{heading}</p>
            <p className="text-ink-muted">{tBudget("spent", { amount: money(state.spent) })}</p>
            {state.kind === "ok" ? (
              <p>{t("rest", { amount: money(state.rest) })}</p>
            ) : (
              <p className="text-danger">{t("over", { amount: money(state.over) })}</p>
            )}
            <button type="button" className={`${buttonClass} ${touch}`} onClick={() => setDialogOpen(true)}>
              {t("edit")}
            </button>
          </div>
          <div
            aria-hidden="true"
            data-testid="budget-bars"
            data-over={state.overBar}
            ref={bars}
            className="flex h-space-2 overflow-hidden rounded-full bg-surface-sunken"
          >
            <span className="w-(--spent-width) bg-ink-muted/55 transition-all duration-slow ease-standard" />
            <span
              className={`w-(--pick-width) transition-all duration-slow ease-standard ${state.overBar ? "bg-danger" : "bg-success"}`}
            />
          </div>
          <p className="flex flex-wrap gap-x-space-4 text-sm text-ink-muted">
            <span>{t("legendSpent")}</span>
            <span>{t("legendDraft", { amount: money(draftCents) })}</span>
          </p>
          {isList && <p className="text-sm text-ink-muted">{t("listCountsToo")}</p>}
        </>
      )}
      <BudgetDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={dialogTitle}
        scope={scope}
        budget={view}
        onChanged={(next) => {
          setBudget({ status: "ready", view: next });
          setDialogOpen(false);
          void load();
        }}
        reload={load}
      />
    </section>
  );
}
