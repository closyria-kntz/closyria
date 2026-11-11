"use client";

import type { BudgetView, ItemCounts, ItemView, ReferenceView, TagView, WishlistView } from "@closyria/shared";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { z } from "zod";
import { ARTICLES_PATH, BOARD_PARAM, BOARD_VALUE, viewStep } from "@/lib/articles-address";
import { draftTotals, formatAmount } from "@/lib/budget";
import { flyTo } from "@/lib/fly-to";
import { createTakeGuard } from "@/lib/gift-check";
import { useLiveRefresh } from "@/lib/live-changes";
import { profileHref, useCurrentProfile, useLoveLevels, useProfilesReady } from "@/lib/profile-context";
import { createTickQueue, type TickQueue } from "@/lib/tick-queue";
import { pushUndo } from "@/lib/undo";
import {
  type BudgetScope,
  fetchAllWishes,
  fetchFacets,
  fetchItemCounts,
  fetchItemsPage,
  fetchReference,
  fetchTags,
  fetchWishlists,
  patchItem,
} from "@/lib/wardrobe-client";
import {
  activeFilterCount,
  filtersFromParams,
  filtersToParams,
  initialMoreState,
  moreReducer,
  paramsText,
  stillShown,
  toggleSelection,
  toViewQuery,
  type ViewFilters,
  type ViewKey,
  viewStage,
  wishSummary,
} from "@/lib/wardrobe-view";
import { ArticlesTabs } from "./articles-tabs";
import { BudgetCard } from "./budget-card";
import { CaptureForm } from "./capture-form";
import { FilterChips, FiltersMenu, SearchField } from "./filters-bar";
import { GiftReminder } from "./gift-reminder";
import { GroupOrderBanner } from "./group-order-banner";
import { ItemGrid } from "./item-grid";
import { ItemPreview } from "./item-preview";
import { ListTabs } from "./list-tabs";
import { OrderBand } from "./order-band";
import { LIST_PARAM, PREVIEW_PARAM } from "./order-draft";
import { SelectionBar } from "./selection-bar";
import { StageBoard } from "./stage-board";
import { StepChips } from "./step-chips";
import { buttonClass, focusRing, primaryButtonClass } from "./ui";

type Loaded = { items: ItemView[]; nextCursor: string | null; status: "loading" | "ready" | "error" };

const touch = "min-h-touch-target";
/** The text buttons of the tools row: the mockup's light clay (38 px on a phone, 44 above; a finger wide anyway). */
const toolButtonClass = `hit-area relative inline-flex h-control-sm items-center rounded-button border border-line bg-surface-raised px-space-3-5 text-sm font-strong text-ink hover:bg-surface-strong sm:h-touch-target ${focusRing}`;
const toolPrimaryClass = `hit-area relative inline-flex h-control-sm items-center rounded-button bg-button-bg px-space-3-5 text-sm font-strong text-button-ink sm:h-touch-target ${focusRing}`;

/** « Par étape » needs a computer's width (64 rem and up). */
const DESKTOP_UP = "(min-width: 64rem)";
const subscribeDesktop = (onChange: () => void) => {
  const media = window.matchMedia(DESKTOP_UP);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
const useDesktop = () =>
  useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_UP).matches,
    () => false,
  );

/**
 * « Mes articles » (refonte Boudoir): « Tout » or one step (Envies, Commandés, Reçus, Dans mon dressing, À vendre),
 * with the tabs « Articles · Listes · Commandes groupées », the step chips and their numbers; filters in the address,
 * infinite scroll, a pill and a « … » menu on each card. « Sélectionner » turns each card into a toggle and brings the
 * selection bar; « Terminé » (or Escape) leaves the mode and forgets the selection (spec §3.4). On a computer,
 * « Par étape » shows « Tout » in four columns.
 */
export function WardrobeView({ view }: { view: ViewKey }) {
  const t = useTranslations("Views");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const ready = useProfilesReady();
  const current = useCurrentProfile();
  const desktop = useDesktop();
  const step = viewStep(view);
  // « Par étape »: on « Tout », on a computer, while the address says so.
  const boardAsked = view === "tout" && search.get(BOARD_PARAM) === BOARD_VALUE;
  const board = boardAsked && desktop;

  const filters = useMemo(() => filtersFromParams(search), [search]);
  // « Mes envies » only: the list tab in the address (`?liste=<id>`), null for « Toutes mes envies ».
  const listParam = z.uuid().safeParse(search.get(LIST_PARAM));
  const listId = view === "envies" && listParam.success ? listParam.data : null;
  // The list id of the address counts only once her lists were read and know it (a deleted list is not asked for).
  const [lists, setLists] = useState<{ status: "loading" | "ready"; items: WishlistView[] }>({
    status: "loading",
    items: [],
  });
  const activeList = lists.items.find((list) => list.id === listId) ?? null;
  const listPending = listId !== null && lists.status === "loading";
  const queryListId = activeList ? listId : null;
  // A list tab shows the list's wishes of every profile; the other tabs and views, the current profile's items.
  const query = useMemo(
    () => toViewQuery(view, filters, current.id, queryListId),
    [view, filters, current.id, queryListId],
  );
  const queryKey = JSON.stringify(query);

  const [data, setData] = useState<Loaded>({ items: [], nextCursor: null, status: "loading" });
  const [more, dispatchMore] = useReducer(moreReducer, initialMoreState);
  const { loading: loadingMore, failed: moreFailed } = more;
  const [tooMany, setTooMany] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [shops, setShops] = useState<{ id: string; name: string }[]>([]);
  const [tags, setTags] = useState<TagView[]>([]);
  const [reference, setReference] = useState<ReferenceView | null>(null);
  // Bumped to read the first page again (retry, undo): the effect depends on it.
  const [reloadToken, setReloadToken] = useState(0);
  // « Mes envies »: her lists and every wish of the account at « Repéré », whatever the profile: a list belongs to
  // the account, so its tab, its budget and its band count (and « J'ai commandé » orders) the wishes of every profile.
  const [accountWishes, setWishes] = useState<ItemView[]>([]);
  const [wishesError, setWishesError] = useState(false);
  const [wishesReady, setWishesReady] = useState(false);
  const [adding, setAdding] = useState(false);
  const [scopeToken, setScopeToken] = useState(0);
  // The numbers of the chips (and of the columns), read again whenever something may have moved.
  const [counts, setCounts] = useState<ItemCounts | null>(null);
  const [countsToken, setCountsToken] = useState(0);
  const generation = useRef(0);
  const moreController = useRef<AbortController | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  // Filter choices: read once.
  useEffect(() => {
    fetchFacets().then(
      (facets) => setShops(facets.shops),
      () => {},
    );
    fetchTags().then(setTags, () => {});
    fetchReference().then(setReference, () => {});
  }, []);

  useEffect(() => {
    if (view !== "envies" || !ready) return;
    let stale = false;
    setWishesError(false);
    void reloadToken;
    void scopeToken;
    fetchWishlists().then(
      (items) => !stale && setLists({ status: "ready", items }),
      () => !stale && setLists((previous) => ({ ...previous, status: "ready" })),
    );
    fetchAllWishes({ stage: "spotted" }).then(
      // A tick still being saved would be put back by this read: kept as it is, the next change reads it again.
      (items) => {
        if (stale || ticks.current?.busy()) return;
        setWishes(items);
        setWishesReady(true);
      },
      () => !stale && setWishesError(true),
    );
    return () => {
      stale = true;
    };
  }, [view, ready, reloadToken, scopeToken]);
  // « Toutes mes envies »: those of the current profile.
  const wishes = useMemo(
    () => (current.id ? accountWishes.filter((item) => item.profileId === current.id) : accountWishes),
    [accountWishes, current.id],
  );

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    void reloadToken;
    void scopeToken;
    void countsToken;
    fetchItemCounts(current.id, undefined, controller.signal).then(
      (found) => !controller.signal.aborted && setCounts(found),
      () => {},
    );
    return () => controller.abort();
  }, [ready, current.id, reloadToken, scopeToken, countsToken]);

  // First page, again whenever the view, the filters, the profile or the reload token change (not under « Par étape »).
  // biome-ignore lint/correctness/useExhaustiveDependencies: queryKey stands for query.
  useEffect(() => {
    // « Par étape » reads its own columns: the grid's page waits until she leaves it.
    if (!ready || listPending || board) return;
    const mine = ++generation.current;
    const controller = new AbortController();
    setData((previous) => ({ ...previous, status: "loading" }));
    dispatchMore({ type: "reset", generation: mine });
    setSelected(new Set());
    setTooMany(false);
    fetchItemsPage(query, null, undefined, controller.signal).then(
      (page) =>
        mine === generation.current && setData({ items: page.items, nextCursor: page.nextCursor, status: "ready" }),
      () => mine === generation.current && setData({ items: [], nextCursor: null, status: "error" }),
    );
    return () => {
      controller.abort();
      moreController.current?.abort();
    };
  }, [queryKey, ready, reloadToken, listPending, board]);

  const loadMore = useCallback(async () => {
    if (!data.nextCursor || loadingMore || data.status !== "ready") return;
    const mine = generation.current;
    const controller = new AbortController();
    moreController.current = controller;
    dispatchMore({ type: "start", generation: mine });
    let failed = false;
    try {
      const page = await fetchItemsPage(query, data.nextCursor, undefined, controller.signal);
      if (mine !== generation.current) return;
      setData((previous) => {
        const known = new Set(previous.items.map((item) => item.id));
        return {
          ...previous,
          items: [...previous.items, ...page.items.filter((item) => !known.has(item.id))],
          nextCursor: page.nextCursor,
        };
      });
    } catch {
      failed = true;
    } finally {
      if (moreController.current === controller) moreController.current = null;
      dispatchMore({ type: "end", generation: mine, failed });
    }
  }, [data.nextCursor, data.status, loadingMore, query]);

  // Infinite scroll: the sentinel under the grid asks for the next page when it comes near.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !data.nextCursor || moreFailed || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void loadMore());
    observer.observe(node);
    return () => observer.disconnect();
  }, [data.nextCursor, moreFailed, loadMore]);

  // `replace`: the search writes the address as she types, without a history entry per pause.
  const setFilters = (next: ViewFilters, replace = false) => {
    const params = filtersToParams(next, new URLSearchParams(window.location.search));
    const text = paramsText(params);
    const href = text ? `${pathname}?${text}` : pathname;
    if (replace) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  };

  const reload = useCallback(async () => setReloadToken((value) => value + 1), []);
  const [ticking, setTicking] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const ticks = useRef<TickQueue | null>(null);

  // Changed elsewhere (her phone, another tab): read again, quietly (no loading state), as many items as she has
  // scrolled through so the page does not jump; never during a selection.
  const loadedCount = useRef(0);
  loadedCount.current = data.items.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: queryKey stands for query.
  const refreshQuietly = useCallback(async () => {
    const mine = ++generation.current;
    moreController.current?.abort();
    dispatchMore({ type: "reset", generation: mine });
    const wanted = loadedCount.current;
    const items: ItemView[] = [];
    let cursor: string | null = null;
    try {
      do {
        const page = await fetchItemsPage(query, cursor);
        if (mine !== generation.current) return;
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor && items.length < wanted);
      // A tick saved meanwhile: this read may predate it, the next change reads again.
      if (ticks.current?.busy()) return;
      setData({ items, nextCursor: cursor, status: "ready" });
    } catch {
      // Kept as it is: the next change tries again.
    }
  }, [queryKey]);
  useLiveRefresh(
    () => {
      setScopeToken((value) => value + 1);
      void refreshQuietly();
    },
    // Not while a tick is being saved or the order is being sent: the read would put the old ticks back for a moment.
    ready && !selecting && !ticking && !ordering && data.status === "ready",
  );
  const gone = useCallback((ids: readonly string[]) => {
    const away = new Set(ids);
    setData((previous) => ({ ...previous, items: previous.items.filter((item) => !away.has(item.id)) }));
    setWishes((previous) => previous.filter((item) => !away.has(item.id)));
    setCountsToken((value) => value + 1);
  }, []);

  // A card changed from its pill or its « … » menu: kept while it still belongs to the view and its filters.
  const { tag, levels, priority, stage: stageFilter } = filters;
  const levelsKey = levels?.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: levelsKey stands for levels.
  const changed = useCallback(
    (item: ItemView) => {
      setWishes((previous) =>
        item.stage === "spotted"
          ? previous.map((known) => (known.id === item.id ? item : known))
          : previous.filter((known) => known.id !== item.id),
      );
      // A list tab holds the wishes of every profile: a card there never leaves for its profile.
      const stays = stillShown(item, view, listId ? null : current.id, { stage: stageFilter, tag, levels, priority });
      setData((previous) => ({
        ...previous,
        items: stays
          ? previous.items.map((known) => (known.id === item.id ? item : known))
          : previous.items.filter((known) => known.id !== item.id),
      }));
      setCountsToken((value) => value + 1);
    },
    [view, stageFilter, current.id, listId, tag, levelsKey, priority],
  );
  const trashed = useCallback((id: string) => gone([id]), [gone]);

  // « Mes envies »: « Je le prends » / « Retirer » on a card, and the quick look (?apercu=<item>, the back button closes it).
  const tItem = useTranslations("Item");
  const locale = useLocale();
  const loveLevels = useLoveLevels();
  // Ticks are saved one request at a time per wish, last wins; « J'ai commandé » waits for them all (`idle`).
  const setTick = useCallback((id: string, inOrderDraft: boolean) => {
    const apply = (item: ItemView) => (item.id === id ? { ...item, inOrderDraft } : item);
    setWishes((previous) => previous.map(apply));
    setData((previous) => ({ ...previous, items: previous.items.map(apply) }));
  }, []);
  if (!ticks.current) {
    ticks.current = createTickQueue<ItemView>(
      async (id, wanted) => {
        const result = await patchItem(id, { inOrderDraft: wanted });
        if (result.ok) return { ok: true, value: result.item };
        failure.current = result.error;
        return { ok: false };
      },
      (id, outcome) => {
        if (outcome.ok) return changedRef.current?.(outcome.value);
        setTick(id, outcome.confirmed);
        pushUndo(tItemRef.current(`errors.${failure.current}` as "errors.failed"), null);
      },
      setTicking,
    );
  }
  const failure = useRef("failed");
  const changedRef = useRef<((item: ItemView) => void) | null>(null);
  changedRef.current = changed;
  const tItemRef = useRef(tItem);
  tItemRef.current = tItem;
  // « Je le prends » shows at once, then asks whether a friend plans to give it (« Attends un peu 🎁 »): saved only
  // once she goes on, put back if she waits. « Retirer » never asks.
  const takeGuard = useRef(createTakeGuard());
  const take = useCallback(
    async (item: ItemView, photo?: Element | null) => {
      const next = !item.inOrderDraft;
      // A second tap while the first is being checked: the first is taken back, nothing was saved.
      if (!next && takeGuard.current.cancel(item.id)) return setTick(item.id, false);
      // The tick is state at once, saved in the background; the flight is only a flourish and waits for nothing.
      // The band shows first (it is hidden while nothing is ticked), then the photo shape flies to it.
      flushSync(() => setTick(item.id, next));
      const band = document.querySelector("[data-testid=order-band]");
      if (next && photo && band) {
        // One effect per moment: the flight is it, so the count's roll and the checks' draw stand still.
        for (const animation of document.getAnimations()) {
          const name = (animation as CSSAnimation).animationName;
          if (name === "count-roll" || name === "chip-check-draw") animation.cancel();
        }
        void flyTo(photo, band, "var(--color-accent)");
      }
      if (next) {
        const outcome = await takeGuard.current.check(item.id);
        if (outcome === "cancelled") return;
        if (outcome === "wait") return setTick(item.id, false);
      }
      ticks.current?.set(item.id, next, item.inOrderDraft);
    },
    [setTick],
  );
  const previewId = view === "envies" ? search.get(PREVIEW_PARAM) : null;
  const previewItem = previewId ? (data.items.find((item) => item.id === previewId) ?? null) : null;
  const pushedPreview = useRef(false);
  // The address is read when she acts (not at render), so the callbacks stay still and the cards do not redraw.
  const addressWith = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(window.location.search);
      if (id) params.set(PREVIEW_PARAM, id);
      else params.delete(PREVIEW_PARAM);
      const text = paramsText(params);
      return text ? `${pathname}?${text}` : pathname;
    },
    [pathname],
  );
  const openPreview = useCallback(
    (item: ItemView) => {
      pushedPreview.current = true;
      router.push(addressWith(item.id), { scroll: false });
    },
    [router, addressWith],
  );
  const closePreview = () => {
    // Already gone from the address (back button): nothing to do.
    if (!new URLSearchParams(window.location.search).has(PREVIEW_PARAM)) return;
    if (pushedPreview.current) {
      pushedPreview.current = false;
      router.back();
    } else router.replace(addressWith(null), { scroll: false });
  };
  const actions = useMemo(
    () => ({
      onChanged: changed,
      onTrashed: trashed,
      reload,
      ...(view === "envies"
        ? { onTake: (item: ItemView, photo?: Element | null) => void take(item, photo), onPreview: openPreview }
        : {}),
    }),
    [changed, trashed, reload, view, take, openPreview],
  );

  useEffect(() => () => moreController.current?.abort(), []);

  const leaveSelection = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
    setTooMany(false);
  }, []);
  const toggle = useCallback(
    (id: string) => {
      const { next, refused } = toggleSelection(selected, id);
      setTooMany(refused);
      setSelected(next);
    },
    [selected],
  );
  const selection = useMemo(() => (selecting ? { selected, onToggle: toggle } : null), [selecting, selected, toggle]);

  // Escape leaves the mode, unless it is closing a window (a choice of the selection bar).
  useEffect(() => {
    if (!selecting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector("dialog:modal")) {
        leaveSelection();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selecting, leaveSelection]);

  // The tabs and the budget card of « Mes envies »; the ticked wishes of the scope are counted here, once.
  // A list tab: every wish of the list, whatever the profile, as the server orders them (and as
  // /envies/commande?liste=… shows them).
  const scopeWishes = useMemo(() => {
    if (!listId) return wishes;
    const inList = new Set(activeList?.itemIds ?? []);
    return accountWishes.filter((item) => inList.has(item.id));
  }, [wishes, accountWishes, listId, activeList]);
  const draftCents = draftTotals(scopeWishes, null).totalCents;
  const budgetScope: BudgetScope | null = listId
    ? { wishlistId: listId }
    : current.id
      ? { profileId: current.id }
      : null;
  // The budget of the scope as the card read it (the band needs it); kept with its scope so another one never shows.
  const [bandBudget, setBandBudget] = useState<{ key: string; view: BudgetView | null } | null>(null);
  const scopeKey = JSON.stringify(budgetScope);
  const budgetOfScope = bandBudget?.key === scopeKey ? bandBudget.view : null;
  const tabs = useMemo(
    () =>
      lists.items.map((list) => {
        const inList = new Set(list.itemIds);
        return { list, count: accountWishes.filter((item) => inList.has(item.id)).length };
      }),
    [lists.items, accountWishes],
  );
  const chooseList = (id: string | null) => {
    const params = new URLSearchParams(search.toString());
    if (id) params.set(LIST_PARAM, id);
    else params.delete(LIST_PARAM);
    const text = paramsText(params);
    router.push(text ? `${pathname}?${text}` : pathname, { scroll: false });
  };
  // A list that no longer exists: back to « Toutes mes envies ».
  useEffect(() => {
    if (!listId || lists.status !== "ready" || activeList) return;
    const params = new URLSearchParams(search.toString());
    params.delete(LIST_PARAM);
    const text = paramsText(params);
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  }, [listId, lists.status, activeList, search, router, pathname]);
  const orderHref = (() => {
    const base = profileHref("/envies/commande", current.id, current.isDefault);
    if (!listId) return base;
    return `${base}${base.includes("?") ? "&" : "?"}${LIST_PARAM}=${listId}`;
  })();

  const count = activeFilterCount(filters);
  const label = t(`title.${view}`);
  const isEmpty = data.status === "ready" && data.items.length === 0;
  // The view's one stage, if it has one: moving there changes nothing (« Tout » mixes them).
  const singleStage = filters.stage ?? viewStage(view);
  const typeName = useMemo(() => {
    const names = new Map(reference?.categories.map((category) => [category.id, category.name]) ?? []);
    // Her correction first, else the product's own type (the last of its path).
    return (item: ItemView) =>
      (item.categoryId ? names.get(item.categoryId) : undefined) ?? item.product.traits.category.at(-1) ?? null;
  }, [reference]);
  const boardHref = (() => {
    const params = new URLSearchParams(search.toString());
    if (boardAsked) params.delete(BOARD_PARAM);
    else params.set(BOARD_PARAM, BOARD_VALUE);
    const text = paramsText(params);
    return text ? `${ARTICLES_PATH}?${text}` : ARTICLES_PATH;
  })();

  const summary = view === "envies" && wishesReady ? wishSummary(scopeWishes) : null;
  const withoutSearch = ({ q: _, ...rest }: ViewFilters): ViewFilters => rest;
  const showBudget = view === "envies" && budgetScope !== null && (!listId || activeList !== null);

  return (
    <div className="flex flex-col gap-space-4 pt-space-5 pb-space-6">
      <div className="flex items-center justify-between gap-space-3">
        <h1 className="font-title text-page-title leading-none font-regular">{t("pageTitle")}</h1>
        {view === "tout" && desktop && (
          <button
            type="button"
            aria-pressed={board}
            onClick={() => router.push(boardHref, { scroll: false })}
            className={`inline-flex min-h-touch-target items-center justify-center rounded-pill px-space-4 text-sm font-bold ${
              board ? "bg-ink text-surface" : "bg-surface-sunken text-ink"
            } ${focusRing}`}
          >
            {t("board.toggle")}
          </button>
        )}
      </div>
      <ArticlesTabs current="articles" lists={view === "envies" && lists.status === "ready" ? lists.items : null} />
      <StepChips current={step} counts={counts} />
      {view === "envies" && <ListTabs lists={tabs} current={listId} allCount={wishes.length} onChange={chooseList} />}
      {view === "envies" &&
        lists.items
          .filter((list) => list.giftReminderDue)
          .map((list) => (
            <GiftReminder
              key={list.id}
              list={list}
              linked
              onAnswered={(answered) =>
                setLists((previous) => ({
                  ...previous,
                  items: previous.items.map((known) => (known.id === answered.id ? answered : known)),
                }))
              }
            />
          ))}
      {view === "envies" && lists.items.map((list) => <GroupOrderBanner key={`group-${list.id}`} list={list} />)}
      {/* Positioned: the filters menu opens against this row (full width on a phone, under the tools from sm up). */}
      <div className="relative flex flex-wrap items-end justify-between gap-x-space-5 gap-y-space-4">
        {(summary || showBudget) && (
          <div className="flex min-w-space-0 flex-col gap-space-3">
            {summary && (
              <ul aria-label={t("summary.label")} data-testid="wish-summary" className="flex flex-wrap gap-space-2">
                <li className="glass rounded-pill px-space-3 py-space-1-5 text-sm tabular-nums">
                  {t.rich("summary.count", { count: summary.count, b: (chunks) => <b>{chunks}</b> })}
                </li>
                <li className="glass rounded-pill px-space-3 py-space-1-5 text-sm tabular-nums">
                  {t.rich("summary.total", {
                    amount: formatAmount(locale, summary.totalCents),
                    b: (chunks) => <b>{chunks}</b>,
                  })}
                </li>
                {summary.drops > 0 && (
                  <li className="rounded-pill bg-success-soft px-space-3 py-space-1-5 text-sm font-strong text-success tabular-nums">
                    {t("summary.drops", { count: summary.drops })}
                  </li>
                )}
              </ul>
            )}
            {showBudget && budgetScope && (
              <BudgetCard
                scope={budgetScope}
                draftCents={draftCents}
                listName={activeList?.name}
                reloadKey={reloadToken + scopeToken}
                onBudget={(next) => setBandBudget({ key: scopeKey, view: next })}
              />
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-space-2">
          <SearchField
            value={filters.q}
            label={t(view === "envies" ? "filters.search.labelEnvies" : "filters.search.label")}
            onChange={(q) => setFilters(q ? { ...filters, q } : withoutSearch(filters), true)}
          />
          <FiltersMenu
            filters={filters}
            onChange={setFilters}
            shops={shops}
            tags={tags}
            reference={reference}
            activeCount={count}
            sortable={!listId}
          />
          {!board && (selecting || data.items.length > 0) && (
            <button
              type="button"
              className={`${selecting ? toolPrimaryClass : toolButtonClass}`}
              onClick={() => (selecting ? leaveSelection() : setSelecting(true))}
            >
              {selecting ? t("selection.done") : t("selection.start")}
            </button>
          )}
          {view === "envies" && !filters.stage && !selecting && (
            <Link href={orderHref} className={toolButtonClass}>
              {t("prepareOrder")}
            </Link>
          )}
          {view === "envies" && (
            <button
              type="button"
              aria-expanded={adding}
              onClick={() => setAdding((value) => !value)}
              className={`hit-area relative inline-flex h-control-md items-center justify-center rounded-button bg-button-bg px-space-4 text-sm font-strong text-button-ink sm:h-control-xl sm:px-space-5-5 sm:text-control ${focusRing}`}
            >
              {t("tools.add")}
            </button>
          )}
        </div>
      </div>
      {adding && (
        <section
          aria-label={t("tools.addTitle")}
          className="glass flex flex-col items-end gap-space-2 rounded-card p-space-4"
        >
          <div className="w-full">
            <CaptureForm />
          </div>
          <button type="button" className={`${buttonClass} ${touch}`} onClick={() => setAdding(false)}>
            {t("tools.close")}
          </button>
        </section>
      )}
      {view === "envies" && wishesError && (
        <div className="flex flex-wrap items-center gap-space-3">
          <p role="alert" className="text-sm text-danger">
            {t("loadError")}
          </p>
          <button
            type="button"
            className={`${buttonClass} ${touch}`}
            onClick={() => setScopeToken((value) => value + 1)}
          >
            {t("retry")}
          </button>
        </div>
      )}
      {selecting && selected.size === 0 && <p className="text-sm text-ink-muted">{t("selection.hint")}</p>}
      <FilterChips activeCount={count} onClearAll={() => setFilters(filters.sort ? { sort: filters.sort } : {})} />

      {data.status === "error" && (
        <div className="flex flex-col items-start gap-space-2">
          <p role="alert" className="text-sm text-danger">
            {t("loadError")}
          </p>
          <button type="button" className={`${buttonClass} ${touch}`} onClick={() => void reload()}>
            {t("retry")}
          </button>
        </div>
      )}
      {board && (
        <StageBoard filters={filters} profileId={current.id} counts={counts} reloadKey={reloadToken + countsToken} />
      )}
      {!board && (data.status === "loading" || !ready) && data.items.length === 0 && (
        <p role="status" className="text-ink-muted">
          {t("loading")}
        </p>
      )}

      {!board && isEmpty && (
        <section className="flex flex-col items-start gap-space-3 rounded-card bg-surface-sunken p-space-5">
          {count > 0 ? (
            <>
              <h2 className="font-title text-lead font-regular">{t("empty.filtered.title")}</h2>
              <p className="max-w-measure text-ink-muted">{t("empty.filtered.body")}</p>
              <button
                type="button"
                className={`${primaryButtonClass} ${touch}`}
                onClick={() => setFilters(filters.sort ? { sort: filters.sort } : {})}
              >
                {t("empty.filtered.reset")}
              </button>
            </>
          ) : (
            <>
              <h2 className="font-title text-lead font-regular">{t(`empty.${view}.title`)}</h2>
              <p className="max-w-measure text-ink-muted">{t(`empty.${view}.body`)}</p>
              <Link href="/" className={`${primaryButtonClass} ${touch}`}>
                {t("empty.action")}
              </Link>
            </>
          )}
        </section>
      )}

      {!board && data.items.length > 0 && (
        <ItemGrid label={label} items={data.items} actions={actions} selection={selection} typeName={typeName}>
          <div ref={sentinel} aria-hidden="true" />
          {loadingMore && (
            <p role="status" className="text-center text-sm text-ink-muted">
              {t("loadingMore")}
            </p>
          )}
          {data.nextCursor && (moreFailed || typeof IntersectionObserver === "undefined") && (
            <div className="flex flex-col items-center gap-space-2">
              {moreFailed && (
                <p role="alert" className="text-sm text-danger">
                  {t("loadError")}
                </p>
              )}
              <button type="button" className={`${buttonClass} ${touch}`} onClick={() => void loadMore()}>
                {t("loadMore")}
              </button>
            </div>
          )}
        </ItemGrid>
      )}

      {tooMany && (
        <p role="alert" className="text-sm text-danger">
          {t("selection.tooMany")}
        </p>
      )}
      {selecting && selected.size > 0 && (
        <SelectionBar
          currentStage={singleStage}
          ids={[...selected]}
          onClear={() => {
            setSelected(new Set());
            setTooMany(false);
          }}
          onSelectAll={() => setSelected(new Set(data.items.slice(0, 200).map((item) => item.id)))}
          onGone={gone}
          reload={reload}
        />
      )}
      {view === "envies" && budgetScope && (!listId || activeList) && (
        <OrderBand
          scope={budgetScope}
          items={scopeWishes}
          budget={budgetOfScope}
          listName={activeList?.name}
          settle={async () => {
            // A tick still being checked (« Attends un peu 🎁 ») is saved, or put back, before the order.
            await takeGuard.current.idle();
            await ticks.current?.idle();
          }}
          onOrderingChange={setOrdering}
          onOrdered={async () => {
            setScopeToken((value) => value + 1);
            await reload();
          }}
          onToggle={(item) => void take(item)}
        />
      )}
      {view === "envies" && (
        <ItemPreview
          item={previewItem}
          levels={loveLevels}
          money={(cents) => formatAmount(locale, cents)}
          onClose={closePreview}
          onToggle={(item) => void take(item)}
        />
      )}
    </div>
  );
}
