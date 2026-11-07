"use client";

import type { BudgetHistory, BudgetView, ItemView } from "@closyria/shared";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { draftTotals, formatAmount, orderDraftErrorKey, sortForOrder } from "@/lib/budget";
import { useLiveRefresh } from "@/lib/live-changes";
import { levelOf } from "@/lib/love-levels";
import { profileHref, useCurrentProfile, useLoveLevels, useProfilesReady } from "@/lib/profile-context";
import { pushUndo } from "@/lib/undo";
import {
  type BudgetScope,
  fetchBudget,
  fetchBudgetHistory,
  fetchItemsPage,
  fetchWishlists,
  orderDraftOrdered,
  patchItem,
  undoWith,
} from "@/lib/wardrobe-client";
import { BudgetDialog } from "./budget-dialog";
import { ItemPreview } from "./item-preview";
import { buttonClass, focusRing } from "./ui";

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

const touch = "min-h-touch-target";
/** The list scope lives in the address: `/envies/commande?liste=<id>`. */
export const LIST_PARAM = "liste";
/** The item shown in the quick preview, kept in the address so the back button closes it. */
export const PREVIEW_PARAM = "apercu";

type Items = { status: "loading" | "ready" | "error" | "missing"; items: ItemView[]; listName: string | null };
type Budget = { status: "loading" | "ready" | "error"; view: BudgetView | null; history: BudgetHistory["periods"] };

/** Every wish of the scope at « Repéré », page by page. Throws on failure. */
async function fetchAllWishes(query: Record<string, string>): Promise<ItemView[]> {
  const items: ItemView[] = [];
  let cursor: string | null = null;
  do {
    const page = await fetchItemsPage(query, cursor);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

/**
 * « Préparer une commande » (spec §3.6): the wishes of the current profile, or of one list, « Ce que j'aime le plus »
 * first; each row is ticked with a tap and the ticks are saved (`inOrderDraft`, no toast: a checklist). The budget
 * (§3.7) on top, the totals and what would be left at the bottom, « J'ai commandé » moves the ticked ones.
 */
export function OrderDraft() {
  const t = useTranslations("OrderDraft");
  const locale = useLocale();
  const search = useSearchParams();
  const ready = useProfilesReady();
  const current = useCurrentProfile();
  const levels = useLoveLevels();
  const listParam = z.uuid().safeParse(search.get(LIST_PARAM));
  const listId = listParam.success ? listParam.data : null;
  const scope = useMemo<BudgetScope | null>(
    () => (listId ? { wishlistId: listId } : current.id ? { profileId: current.id } : null),
    [listId, current.id],
  );
  const scopeKey = JSON.stringify(scope);

  const [items, setItems] = useState<Items>({ status: "loading", items: [], listName: null });
  const [budget, setBudget] = useState<Budget>({ status: "loading", view: null, history: [] });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ordering, setOrdering] = useState(false);
  const generation = useRef(0);
  const budgetTitleId = useId();
  const bandTitleId = useId();

  // Only the latest read applies: a late answer for a previous scope never overwrites the current one.
  const budgetGeneration = useRef(0);
  const loadBudget = useCallback(async (target: BudgetScope) => {
    const mine = ++budgetGeneration.current;
    try {
      const view = await fetchBudget(target);
      const history =
        view && (view.period === "week" || view.period === "month") ? await fetchBudgetHistory(target) : [];
      if (mine === budgetGeneration.current) setBudget({ status: "ready", view, history });
    } catch {
      if (mine === budgetGeneration.current) setBudget({ status: "error", view: null, history: [] });
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scopeKey stands for scope.
  const load = useCallback(async () => {
    const mine = ++generation.current;
    if (!scope) {
      setItems({ status: "ready", items: [], listName: null });
      setBudget({ status: "ready", view: null, history: [] });
      return;
    }
    void loadBudget(scope);
    try {
      let listName: string | null = null;
      if ("wishlistId" in scope) {
        const list = (await fetchWishlists()).find((candidate) => candidate.id === scope.wishlistId);
        if (!list) {
          if (mine === generation.current) setItems({ status: "missing", items: [], listName: null });
          return;
        }
        listName = list.name;
      }
      const query: Record<string, string> =
        "wishlistId" in scope
          ? { stage: "spotted", wishlist: scope.wishlistId }
          : { stage: "spotted", profile: scope.profileId, sort: "love" };
      const wishes = sortForOrder(await fetchAllWishes(query));
      if (mine === generation.current) setItems({ status: "ready", items: wishes, listName });
    } catch {
      if (mine === generation.current) setItems((previous) => ({ ...previous, status: "error" }));
    }
  }, [scopeKey, loadBudget]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);
  // Changed elsewhere (her phone, another tab): ticks, prices and budget again (already without a loading state); not while ordering.
  useLiveRefresh(() => void load(), ready && !ordering && items.status === "ready");

  const setTicked = (id: string, inOrderDraft: boolean) =>
    setItems((previous) => ({
      ...previous,
      items: previous.items.map((item) => (item.id === id ? { ...item, inOrderDraft } : item)),
    }));

  async function toggle(item: ItemView) {
    const next = !item.inOrderDraft;
    setError(null);
    setTicked(item.id, next);
    const result = await patchItem(item.id, { inOrderDraft: next });
    if (!result.ok) {
      setTicked(item.id, !next);
      setError(t("toggleFailed"));
    }
  }

  // The preview lives in the address (?apercu=<item>): the back button closes it and the page stays put.
  const router = useRouter();
  const pathname = usePathname();
  const previewId = search.get(PREVIEW_PARAM);
  const previewItem = items.items.find((candidate) => candidate.id === previewId) ?? null;
  const pushedPreview = useRef(false);
  const addressWith = (id: string | null) => {
    const params = new URLSearchParams(search.toString());
    if (id) params.set(PREVIEW_PARAM, id);
    else params.delete(PREVIEW_PARAM);
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  };
  const openPreview = (id: string) => {
    pushedPreview.current = true;
    router.push(addressWith(id), { scroll: false });
  };
  const closePreview = () => {
    // Already gone from the address (back button): nothing to do.
    if (!new URLSearchParams(window.location.search).has(PREVIEW_PARAM)) return;
    if (pushedPreview.current) {
      pushedPreview.current = false;
      router.back();
    } else router.replace(addressWith(null), { scroll: false });
  };

  async function order() {
    if (!scope || ordering) return;
    setOrdering(true);
    setError(null);
    const result = await orderDraftOrdered(scope);
    setOrdering(false);
    if (!result.ok) return setError(t(`errors.${orderDraftErrorKey(result.error)}`));
    pushUndo(t("ordered", { count: result.itemIds.length }), undoWith(result.undo, load));
    await load();
  }

  const totals = draftTotals(items.items, budget.view);
  const money = (cents: number) => formatAmount(locale, cents);
  const isList = scope !== null && "wishlistId" in scope;
  const budgetTitle = t(isList ? "budget.listTitle" : "budget.profileTitle");
  const back = isList
    ? { href: `/listes/${listId}`, label: t("backToList", { name: items.listName ?? "" }) }
    : { href: profileHref("/envies", current.id, current.isDefault), label: t("backToWishes") };

  if (!ready || items.status === "loading") {
    return (
      <p role="status" className="text-ink-muted">
        {t("loading")}
      </p>
    );
  }
  if (items.status === "missing") {
    return (
      <p role="alert" className="text-danger">
        {t("missingList")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-space-4">
      <Link
        href={back.href}
        className={`inline-flex items-center self-start rounded-button text-sm text-accent ${touch} ${focusRing}`}
      >
        {back.label}
      </Link>
      <h1 className="font-display text-title font-strong">{t("title")}</h1>

      {scope && (
        <section
          aria-labelledby={budgetTitleId}
          className="flex flex-col gap-space-3 rounded-card border border-line bg-surface-raised p-space-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-space-3">
            <div className="flex flex-col gap-space-1">
              <h2 id={budgetTitleId} className="font-display text-lead font-strong">
                {budgetTitle}
              </h2>
              <div aria-live="polite" className="flex flex-col gap-space-1">
                <BudgetLines budget={budget} money={money} />
              </div>
            </div>
            <button type="button" className={`${buttonClass} ${touch}`} onClick={() => setDialogOpen(true)}>
              {t("budget.open")}
            </button>
          </div>
          {budget.history.length > 0 && budget.view && (
            <details className="text-sm">
              <summary className={`cursor-pointer rounded-button text-ink-muted ${focusRing}`}>
                {t(budget.view.period === "week" ? "budget.historyWeeks" : "budget.historyMonths")}
              </summary>
              <ul className="mt-space-2 flex flex-col gap-space-1">
                {budget.history.map((period) => (
                  <li key={period.start}>
                    {budget.view?.period === "week"
                      ? t("budget.historyWeek", {
                          start: dayOf(locale, period.start),
                          spent: money(period.spentCents),
                          amount: money(period.amountCents),
                        })
                      : t("budget.historyMonth", {
                          month: monthOf(locale, period.start),
                          spent: money(period.spentCents),
                          amount: money(period.amountCents),
                        })}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {items.status === "error" ? (
        <div className="flex flex-col items-start gap-space-2">
          <p role="alert" className="text-sm text-danger">
            {t("loadError")}
          </p>
          <button type="button" className={`${buttonClass} ${touch}`} onClick={() => void load()}>
            {t("retry")}
          </button>
        </div>
      ) : items.items.length === 0 ? (
        <section className="flex flex-col gap-space-2 rounded-card border border-line bg-surface-raised p-space-5">
          <h2 className="font-display text-lead font-strong">{t("empty.title")}</h2>
          <p className="max-w-measure text-ink-muted">{t("empty.body")}</p>
        </section>
      ) : (
        <>
          <p className="text-sm text-ink-muted">{t("hint")}</p>
          <ul aria-label={t("listLabel")} className="flex flex-col gap-space-2">
            {items.items.map((item) => {
              const level = item.loveLevel === null ? null : levelOf(levels, item.loveLevel);
              const price = item.product.priceCents;
              return (
                <li key={item.id}>
                  <div className="flex items-center gap-space-2 rounded-card border-2 border-line bg-surface-raised py-space-2 pr-space-3 has-checked:border-accent">
                    <label className="relative flex size-touch-target shrink-0 cursor-pointer items-center justify-center rounded-button has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring has-focus-visible:outline-solid">
                      <input
                        type="checkbox"
                        checked={item.inOrderDraft}
                        onChange={() => void toggle(item)}
                        aria-labelledby={`order-name-${item.id}`}
                        className="peer absolute inset-0 size-full cursor-pointer opacity-0"
                      />
                      <span
                        data-testid="order-check"
                        className="pointer-events-none flex size-space-5 items-center justify-center rounded-sm border-2 border-ink-muted text-accent-ink peer-checked:border-accent peer-checked:bg-accent"
                      >
                        {item.inOrderDraft && (
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 16 16"
                            className="size-space-3"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                          >
                            <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                    </label>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-hidden="true"
                      onClick={() => openPreview(item.id)}
                      className="size-space-7 shrink-0 overflow-hidden rounded-md bg-media-backdrop"
                    >
                      {item.coverUrl && (
                        // biome-ignore lint/performance/noImgElement: photos come from our own API, already resized.
                        <img
                          src={item.coverUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="size-full object-cover"
                        />
                      )}
                    </button>
                    <span className="flex min-w-space-0 flex-1 flex-col items-start">
                      <button
                        type="button"
                        onClick={() => openPreview(item.id)}
                        className={`max-w-full truncate rounded-sm text-left font-strong ${focusRing}`}
                      >
                        <span id={`order-name-${item.id}`}>{item.name?.trim() || t("row.noName")}</span>
                        <span aria-hidden="true" className="text-ink-muted">
                          {" "}
                          ›
                        </span>
                      </button>
                      {(level || item.priority) && (
                        <span className="text-sm text-ink-muted">
                          {[level && `${level.emoji} ${level.label}`, item.priority && t("row.priority")]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
                      {isHttpUrl(item.product.canonicalUrl) && (
                        <a
                          href={item.product.canonicalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`inline-flex max-w-full items-center gap-space-1 rounded-sm text-sm text-ink-muted underline underline-offset-2 hover:text-ink ${focusRing}`}
                        >
                          <span className="truncate">{t("row.viewAt", { shop: item.product.shop.name })}</span>
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 16 16"
                            className="size-space-3 shrink-0"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M5 11l6-6M6 5h5v5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </a>
                      )}
                    </span>
                    <span className={`shrink-0 text-sm ${price === null ? "text-ink-muted" : "font-strong"}`}>
                      {price === null ? t("row.unknownPrice") : money(price)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {scope && (
        <section
          aria-labelledby={bandTitleId}
          className="sticky bottom-space-0 z-10 flex flex-wrap items-center justify-between gap-space-3 rounded-card border-2 border-band-line bg-band p-space-4 text-ink shadow-lifted"
        >
          <h2 id={bandTitleId} className="sr-only">
            {t("band.label")}
          </h2>
          <div aria-live="polite" className="flex flex-col items-start gap-space-1">
            <p className="font-strong">{t("band.total", { count: totals.count, amount: money(totals.totalCents) })}</p>
            {totals.unknownPrices > 0 && (
              <p className="text-sm">{t("band.unknown", { count: totals.unknownPrices })}</p>
            )}
            {totals.afterCents !== null &&
              (totals.afterCents >= 0 ? (
                <p className="rounded-button border border-success-edge bg-success-soft px-space-2 font-strong text-sm text-success">
                  {t("band.left", { amount: money(totals.afterCents) })}
                </p>
              ) : (
                <p className="rounded-button border border-danger-edge bg-danger-soft px-space-2 font-strong text-sm text-danger">
                  {t("band.over", { amount: money(-totals.afterCents) })}
                </p>
              ))}
          </div>
          <button
            type="button"
            disabled={ordering}
            onClick={() => void order()}
            className={`${touch} inline-flex items-center rounded-button bg-band-button px-space-4 py-space-2 text-sm font-strong text-band-button-ink hover:bg-band-button-hover disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus-ring`}
          >
            {t("band.ordered")}
          </button>
        </section>
      )}

      {scope && (
        <BudgetDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title={budgetTitle}
          scope={scope}
          budget={budget.view}
          onChanged={(view) => {
            setDialogOpen(false);
            setBudget({ status: "ready", view, history: [] });
            void loadBudget(scope);
          }}
          reload={async () => {
            await loadBudget(scope);
          }}
        />
      )}
      <ItemPreview
        item={previewItem}
        levels={levels}
        money={money}
        onClose={closePreview}
        onToggle={(item) => void toggle(item)}
      />
    </div>
  );
}

function BudgetLines({ budget, money }: { budget: Budget; money: (cents: number) => string }) {
  const t = useTranslations("OrderDraft.budget");
  const locale = useLocale();
  const { view } = budget;
  if (budget.status === "loading") return <p className="text-sm text-ink-muted">…</p>;
  if (budget.status === "error") return <p className="text-sm text-danger">{t("loadError")}</p>;
  if (!view) return <p className="text-sm text-ink-muted">{t("none")}</p>;
  const amount = money(view.amountCents);
  const dates = { start: dateOf(locale, view.startsOn), end: dateOf(locale, view.endsOn) };
  const title = view.ended
    ? t("ended", { ...dates, amount })
    : view.period === "week"
      ? t("week", { amount })
      : view.period === "month"
        ? t("month", { amount })
        : view.period === "custom"
          ? t("custom", { ...dates, amount })
          : t("plain", { amount });
  return (
    <>
      <p>{title}</p>
      {view.current && (
        <p className="text-sm text-ink-muted">{t("spent", { amount: money(view.current.spentCents) })}</p>
      )}
    </>
  );
}

/** « 1 décembre » from a calendar date (`2026-12-01`). */
function dateOf(locale: string, date: string | null): string {
  if (!date) return "";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** « 26 octobre », the Monday of a past week, in Paris. */
function dayOf(locale: string, at: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "Europe/Paris" }).format(
    new Date(at),
  );
}

/** « octobre », a past month, in Paris. */
function monthOf(locale: string, at: string): string {
  return new Intl.DateTimeFormat(locale, { month: "long", timeZone: "Europe/Paris" }).format(new Date(at));
}
