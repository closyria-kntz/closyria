"use client";

import type { BudgetView, ItemView } from "@closyria/shared";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { budgetCardState, draftTotals, formatAmount, orderDraftErrorKey } from "@/lib/budget";
import { confirmUnlessReserved } from "@/lib/gift-check";
import { useToastLift } from "@/lib/toast-lift";
import { pushUndo } from "@/lib/undo";
import { type BudgetScope, orderDraftOrdered, undoWith } from "@/lib/wardrobe-client";
import { BudgetBars } from "./budget-bars";
import { SquareCheck } from "./square-check";
import { focusRing } from "./ui";

/**
 * « Ma commande »: the band stuck at the bottom of « Mes envies » and of « Préparer une commande ». The ticked wishes
 * of the scope (`items` are those of the scope, ticked or not), what they add up to, what the budget would have left,
 * the two-colour bar, « Voir » to fold the ticked ones out (unticking keeps the row until the list is closed, to tick
 * it again) and « J'ai commandé (n) ». Without a tick the button shakes and says so; `showWhenEmpty` keeps the band
 * on the page that is all about the order.
 */
export function OrderBand({
  scope,
  items,
  budget,
  listName,
  showWhenEmpty = false,
  settle,
  onOrderingChange,
  onOrdered,
  onToggle,
}: {
  scope: BudgetScope;
  items: ItemView[];
  budget: BudgetView | null;
  listName?: string | null | undefined;
  showWhenEmpty?: boolean;
  /** Resolves when every tick or untick has been saved: the order waits for it. */
  settle?: () => Promise<void>;
  /** « J'ai commandé » is being sent (true) or done (false): the page holds its live refresh meanwhile. */
  onOrderingChange?: (ordering: boolean) => void;
  /** The ticked ones went to « Commandé » (or the order was undone): read the page again. */
  onOrdered(): void | Promise<void>;
  onToggle(item: ItemView): void;
}) {
  const t = useTranslations("OrderDraft");
  const locale = useLocale();
  const titleId = useId();
  const listId = useId();
  const [open, setOpen] = useState(false);
  // The ones ticked while the list is open stay in it, ticked or not.
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const [ordering, setOrdering] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [element, setElement] = useState<HTMLElement | null>(null);
  // The undo toast rises above the band instead of covering the totals.
  useToastLift(element);

  // The ticks as they are when the order goes (after `settle`), not when the button was pressed.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const totals = draftTotals(items, budget);
  useEffect(() => {
    if (!open) return setKept(new Set());
    setKept((previous) => {
      const next = new Set(previous);
      for (const item of items) if (item.inOrderDraft) next.add(item.id);
      return next.size === previous.size ? previous : next;
    });
  }, [open, items]);
  const rows = items.filter((item) => item.inOrderDraft || (open && kept.has(item.id)));

  const money = (cents: number) => formatAmount(locale, cents);

  async function order() {
    if (ordering) return;
    if (totals.count === 0) {
      // Ends on `animationend`; nothing to wait for (and no flag left on) when motion is reduced.
      setShaking(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      return pushUndo(t("errors.empty"), null);
    }
    setOrdering(true);
    onOrderingChange?.(true);
    await settle?.();
    // A friend may plan to give some of them: one window for all (« Attendre » orders nothing). Read after `settle`:
    // a tick put back meanwhile (« Attendre » on its own check) is not in it.
    const ticked = itemsRef.current.filter((item) => item.inOrderDraft).map((item) => item.id);
    if (ticked.length === 0) {
      setOrdering(false);
      onOrderingChange?.(false);
      return;
    }
    if (!(await confirmUnlessReserved(ticked, "order"))) {
      setOrdering(false);
      onOrderingChange?.(false);
      return;
    }
    const result = await orderDraftOrdered(scope).finally(() => {
      setOrdering(false);
      onOrderingChange?.(false);
    });
    if (!result.ok) return pushUndo(t(`errors.${orderDraftErrorKey(result.error)}`), null);
    pushUndo(
      t("ordered", { count: result.itemIds.length }),
      undoWith(result.undo, async () => void (await onOrdered())),
    );
    setOpen(false);
    await onOrdered();
  }

  if (rows.length === 0 && totals.count === 0 && !showWhenEmpty) return null;
  const state = budgetCardState(budget, totals.totalCents);
  return (
    <section
      ref={setElement}
      aria-labelledby={titleId}
      data-testid="order-band"
      className="sticky border border-line bg-surface-raised bottom-space-4 z-10 mx-auto flex w-full max-w-band flex-col gap-space-2 rounded-band py-space-2 pr-space-2 pl-space-4 text-ink shadow-block sm:gap-space-2-5 sm:py-space-2-5 sm:pr-space-2-5 sm:pl-space-5"
    >
      {/* One line: what is taken, what the budget would have left, « Voir » and « J'ai commandé (n) ». On a narrow
          phone the bar stays slim (two lines at most): the title steps aside (screen readers keep it) when the budget
          line needs its room, and the buttons stay on the right. */}
      <div className="flex items-center gap-space-3">
        <div className="flex min-w-space-0 flex-1 flex-col">
          <h2
            id={titleId}
            className={`truncate text-caption text-ink-muted ${totals.afterCents !== null ? "max-sm:sr-only" : ""}`}
          >
            {listName ? t("band.titleList", { name: listName }) : t("band.title")}
          </h2>
          <div
            aria-live="polite"
            className="flex flex-wrap items-center gap-x-space-2 gap-y-space-1 text-sm tabular-nums sm:text-control"
          >
            <p key={totals.count} data-testid="count-roll" className="count-roll font-bold">
              {t("band.total", { count: totals.count, amount: money(totals.totalCents) })}
            </p>
            {totals.unknownPrices > 0 && (
              <p className="text-caption text-ink-muted sm:text-sm">
                {t("band.unknown", { count: totals.unknownPrices })}
              </p>
            )}
            {totals.afterCents !== null &&
              (totals.afterCents >= 0 ? (
                <p className="rounded-button border border-success-edge bg-success-soft px-space-2 text-caption font-strong whitespace-nowrap text-success sm:text-sm">
                  {t("band.left", { amount: money(totals.afterCents) })}
                </p>
              ) : (
                <p className="rounded-button border border-danger-edge bg-danger-soft px-space-2 text-caption font-strong whitespace-nowrap text-danger sm:text-sm">
                  {t("band.over", { amount: money(-totals.afterCents) })}
                </p>
              ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-space-2">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((value) => !value)}
            className={`hit-area relative h-control-sm rounded-button bg-surface-strong px-space-3 text-sm font-strong text-ink hover:bg-hint sm:h-touch-target sm:px-space-4 sm:text-control ${focusRing}`}
          >
            {t("band.see")}
          </button>
          <button
            type="button"
            disabled={ordering}
            data-shaking={shaking}
            onAnimationEnd={() => setShaking(false)}
            onClick={() => void order()}
            className={`band-shake hit-area relative inline-flex h-control-sm items-center rounded-button bg-band-button px-space-3 whitespace-nowrap sm:h-control-plus sm:px-space-5 sm:text-control text-sm font-strong text-band-button-ink hover:bg-band-button-hover disabled:opacity-60 ${focusRing}`}
          >
            {t("band.ordered", { count: totals.count })}
          </button>
        </div>
      </div>
      {state.kind !== "none" && (
        <BudgetBars spentPct={state.spentPct} pickPct={state.pickPct} overBar={state.overBar} />
      )}
      {open && (
        <ul id={listId} aria-label={t("band.items")} className="flex max-h-72 flex-col overflow-y-auto">
          {rows.map((item) => {
            const price = item.product.priceCents;
            return (
              <li key={item.id} className="flex items-center gap-space-2">
                <label
                  htmlFor={`band-check-${item.id}`}
                  className="relative flex size-touch-target shrink-0 cursor-pointer items-center justify-center rounded-button has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring has-focus-visible:outline-solid"
                >
                  <SquareCheck
                    id={`band-check-${item.id}`}
                    checked={item.inOrderDraft}
                    onChange={() => onToggle(item)}
                    labelledBy={`band-name-${item.id}`}
                  />
                </label>
                <span id={`band-name-${item.id}`} className="min-w-space-0 flex-1 truncate">
                  {item.name?.trim() || t("row.noName")}
                </span>
                <span className={`shrink-0 text-sm tabular-nums ${price === null ? "text-ink-muted" : "font-strong"}`}>
                  {price === null ? t("row.unknownPrice") : money(price)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
