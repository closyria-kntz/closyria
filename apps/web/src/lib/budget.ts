import {
  type BudgetInput,
  type BudgetPeriod,
  type BudgetView,
  budgetInputSchema,
  type ItemView,
} from "@closyria/shared";
import { parsePriceCents } from "./price";

/** The bottom band of « Préparer une commande » (spec §3.6). */
export type DraftTotals = {
  /** Ticked items. */
  count: number;
  /** Their shop prices added up; an item without a price counts 0. */
  totalCents: number;
  /** Ticked items without a price (« prix inconnu »). */
  unknownPrices: number;
  /** What the budget would have left after the selection (below 0: over); null without a current budget. */
  afterCents: number | null;
};

/** The totals of the ticked items (`inOrderDraft`) among `items`, at the shop's current price. */
export function draftTotals(items: readonly ItemView[], budget: BudgetView | null): DraftTotals {
  let count = 0;
  let totalCents = 0;
  let unknownPrices = 0;
  for (const item of items) {
    if (!item.inOrderDraft) continue;
    count += 1;
    const price = item.product.priceCents;
    if (typeof price === "number") totalCents += price;
    else unknownPrices += 1;
  }
  const current = budget?.current ?? null;
  return { count, totalCents, unknownPrices, afterCents: current ? current.remainingCents - totalCents : null };
}

/** « Ce que j'aime le plus », as the API's `sort=love`: highest level first, priority first, then the newest. */
export function sortForOrder(items: readonly ItemView[]): ItemView[] {
  return [...items].sort(
    (a, b) =>
      (b.loveLevel ?? 0) - (a.loveLevel ?? 0) ||
      Number(b.priority) - Number(a.priority) ||
      b.createdAt.localeCompare(a.createdAt),
  );
}

/** Euros as she says them: « 154 € », « 150,50 € » (cents only when there are some). */
export function formatAmount(locale: string, cents: number, currency = "EUR"): string {
  const digits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100);
}

/** What the budget window holds while she types. */
export type BudgetForm = { amount: string; period: BudgetPeriod; startsOn: string; endsOn: string };

/** The PUT body from the window: an amount above 0 in euros; the dates for « Dates au choix » only (else left out). */
export function budgetInputFrom(
  form: BudgetForm,
): { ok: true; input: BudgetInput } | { ok: false; error: "amount" | "dates" } {
  const amount = parsePriceCents(form.amount);
  if (!amount.ok || !amount.cents) return { ok: false, error: "amount" };
  const input: BudgetInput =
    form.period === "custom"
      ? { amountCents: amount.cents, period: "custom", startsOn: form.startsOn, endsOn: form.endsOn }
      : { amountCents: amount.cents, period: form.period };
  return budgetInputSchema.safeParse(input).success ? { ok: true, input } : { ok: false, error: "dates" };
}

/** The form for an existing budget (or a new one: weekly, empty). */
export function budgetFormOf(budget: BudgetView | null): BudgetForm {
  if (!budget) return { amount: "", period: "week", startsOn: "", endsOn: "" };
  const euros = budget.amountCents / 100;
  return {
    amount: budget.amountCents % 100 === 0 ? String(euros) : euros.toFixed(2).replace(".", ","),
    period: budget.period,
    startsOn: budget.startsOn ?? "",
    endsOn: budget.endsOn ?? "",
  };
}

/** The message of a refused « J'ai commandé ». */
export function orderDraftErrorKey(error: string): "empty" | "tooLarge" | "failed" {
  if (error === "order_draft_empty") return "empty";
  if (error === "order_draft_too_large") return "tooLarge";
  return "failed";
}
