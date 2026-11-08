import type { BudgetView, ItemView } from "@closyria/shared";
import { describe, expect, it } from "vitest";
import {
  budgetCardState,
  budgetInputFrom,
  budgetInputOf,
  draftTotals,
  formatAmount,
  orderDraftErrorKey,
  sortForOrder,
} from "./budget";

const item = (id: string, priceCents: number | null, extra: Partial<ItemView> = {}) =>
  ({
    id,
    inOrderDraft: true,
    loveLevel: 2,
    priority: false,
    createdAt: "2026-11-01T10:00:00.000Z",
    product: { priceCents, currency: "EUR" },
    ...extra,
  }) as unknown as ItemView;

const budget = (remainingCents: number | null): BudgetView => ({
  amountCents: 15_000,
  period: "week",
  startsOn: null,
  endsOn: null,
  current:
    remainingCents === null
      ? null
      : {
          start: "2026-11-02T00:00:00.000+01:00",
          end: "2026-11-09T00:00:00.000+01:00",
          spentCents: 15_000 - remainingCents,
          remainingCents,
        },
  ended: remainingCents === null,
});

describe("draftTotals", () => {
  it("adds the ticked items only, at the shop's current price", () => {
    const items = [item("a", 8900), item("b", 6500), item("c", 1000, { inOrderDraft: false })];
    expect(draftTotals(items, budget(15_000))).toEqual({
      count: 2,
      totalCents: 15_400,
      unknownPrices: 0,
      afterCents: -400,
    });
  });

  it("counts an item without a price as 0 and in unknownPrices", () => {
    expect(draftTotals([item("a", 8900), item("b", null)], budget(10_000))).toEqual({
      count: 2,
      totalCents: 8900,
      unknownPrices: 1,
      afterCents: 1100,
    });
  });

  it("has no « after » without a budget, or once a budget's dates are over", () => {
    expect(draftTotals([item("a", 8900)], null).afterCents).toBeNull();
    expect(draftTotals([item("a", 8900)], budget(null)).afterCents).toBeNull();
  });

  it("is all zeros for an empty selection", () => {
    expect(draftTotals([], null)).toEqual({ count: 0, totalCents: 0, unknownPrices: 0, afterCents: null });
  });
});

describe("sortForOrder", () => {
  it("puts the highest level first, then the priority ones, then the newest", () => {
    const items = [
      item("none", 1, { loveLevel: null }),
      item("like-old", 1, { createdAt: "2026-10-01T10:00:00.000Z" }),
      item("like-new", 1, { createdAt: "2026-11-05T10:00:00.000Z" }),
      item("like-priority", 1, { priority: true, createdAt: "2026-09-01T10:00:00.000Z" }),
      item("fire", 1, { loveLevel: 4 }),
    ];
    expect(sortForOrder(items).map((i) => i.id)).toEqual(["fire", "like-priority", "like-new", "like-old", "none"]);
  });
});

describe("formatAmount", () => {
  it("drops the cents of whole euros and keeps the others", () => {
    expect(formatAmount("fr-FR", 15_400)).toMatch(/^154\s€$/);
    expect(formatAmount("fr-FR", 15_050)).toMatch(/^150,50\s€$/);
    expect(formatAmount("fr-FR", 0)).toMatch(/^0\s€$/);
  });
});

describe("budgetInputFrom", () => {
  it("reads the amount in euros, with or without cents", () => {
    expect(budgetInputFrom({ amount: "150", period: "week", startsOn: "", endsOn: "" })).toEqual({
      ok: true,
      input: { amountCents: 15_000, period: "week" },
    });
    expect(budgetInputFrom({ amount: "150,50", period: "none", startsOn: "x", endsOn: "y" })).toEqual({
      ok: true,
      input: { amountCents: 15_050, period: "none" },
    });
  });

  it("sends the dates for « Dates au choix » only", () => {
    expect(budgetInputFrom({ amount: "300", period: "custom", startsOn: "2026-12-01", endsOn: "2026-12-15" })).toEqual({
      ok: true,
      input: { amountCents: 30_000, period: "custom", startsOn: "2026-12-01", endsOn: "2026-12-15" },
    });
  });

  it("refuses an empty, zero or malformed amount, and missing or reversed dates", () => {
    for (const amount of ["", "0", "abc", "-5"]) {
      expect(budgetInputFrom({ amount, period: "week", startsOn: "", endsOn: "" })).toEqual({
        ok: false,
        error: "amount",
      });
    }
    expect(budgetInputFrom({ amount: "10", period: "custom", startsOn: "", endsOn: "2026-12-15" })).toEqual({
      ok: false,
      error: "dates",
    });
    expect(budgetInputFrom({ amount: "10", period: "custom", startsOn: "2026-12-15", endsOn: "2026-12-01" })).toEqual({
      ok: false,
      error: "dates",
    });
  });
});

describe("orderDraftErrorKey", () => {
  it("names the two refusals of « J'ai commandé », anything else is a failure", () => {
    expect(orderDraftErrorKey("order_draft_empty")).toBe("empty");
    expect(orderDraftErrorKey("order_draft_too_large")).toBe("tooLarge");
    expect(orderDraftErrorKey("failed")).toBe("failed");
    expect(orderDraftErrorKey("not_found")).toBe("failed");
  });
});

describe("budgetInputOf", () => {
  it("gives back the PUT body of a saved budget (for « Annuler »), dates for a custom one only", () => {
    expect(budgetInputOf(budget(100))).toEqual({ amountCents: 15_000, period: "week" });
    expect(budgetInputOf({ ...budget(100), period: "custom", startsOn: "2026-12-01", endsOn: "2026-12-15" })).toEqual({
      amountCents: 15_000,
      period: "custom",
      startsOn: "2026-12-01",
      endsOn: "2026-12-15",
    });
  });
});

describe("budgetCardState", () => {
  const monthly = (amountCents: number, spentCents: number | null): BudgetView => ({
    amountCents,
    period: "month",
    startsOn: null,
    endsOn: null,
    current:
      spentCents === null
        ? null
        : {
            start: "2026-11-01T00:00:00.000+01:00",
            end: "2026-12-01T00:00:00.000+01:00",
            spentCents,
            remainingCents: amountCents - spentCents,
          },
    ended: spentCents === null,
  });

  it("has no budget: none", () => {
    expect(budgetCardState(null, 12_000)).toEqual({ kind: "none" });
  });
  it("500 / 215 spent / 120 ticked: 285 left, bars 43 % and 24 %", () => {
    expect(budgetCardState(monthly(50_000, 21_500), 12_000)).toEqual({
      kind: "ok",
      amount: 50_000,
      spent: 21_500,
      rest: 28_500,
      spentPct: 43,
      pickPct: 24,
      overBar: false,
    });
  });
  it("500 with 580 spent: over by 80, bar full", () => {
    expect(budgetCardState(monthly(50_000, 58_000), 0)).toEqual({
      kind: "over",
      amount: 50_000,
      spent: 58_000,
      over: 8_000,
      spentPct: 100,
      pickPct: 0,
      overBar: true,
    });
  });
  it("what is ticked can push the bar over without the card saying « Dépassé »", () => {
    const state = budgetCardState(monthly(50_000, 40_000), 20_000);
    expect(state).toMatchObject({ kind: "ok", rest: 10_000, spentPct: 80, pickPct: 20, overBar: true });
  });
  it("an ended budget counts 0 spent, and a zero price never gives NaN", () => {
    expect(budgetCardState(monthly(50_000, null), 0)).toMatchObject({
      kind: "ok",
      spent: 0,
      rest: 50_000,
      spentPct: 0,
    });
    expect(budgetCardState({ ...monthly(0, 0) }, 0)).toMatchObject({ spentPct: 0, pickPct: 0 });
  });
});
