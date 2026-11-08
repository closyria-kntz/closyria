"use client";

import type { ItemView, ReferenceView, TagView, WishlistView } from "@closyria/shared";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { z } from "zod";
import { draftTotals } from "@/lib/budget";
import { useLiveRefresh } from "@/lib/live-changes";
import { profileHref, useCurrentProfile, useProfilesReady } from "@/lib/profile-context";
import {
  type BudgetScope,
  fetchAllWishes,
  fetchFacets,
  fetchItemsPage,
  fetchReference,
  fetchTags,
  fetchWishlists,
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
  toItemQuery,
  VIEWS,
  type ViewFilters,
  type ViewKey,
} from "@/lib/wardrobe-view";
import { BudgetCard } from "./budget-card";
import { FiltersBar } from "./filters-bar";
import { ItemGrid } from "./item-grid";
import { ListTabs } from "./list-tabs";
import { LIST_PARAM } from "./order-draft";
import { SelectionBar } from "./selection-bar";
import { buttonClass, primaryButtonClass } from "./ui";

type Loaded = { items: ItemView[]; nextCursor: string | null; status: "loading" | "ready" | "error" };

const touch = "min-h-touch-target";

/**
 * One of the four views (Envies, Commandé, Dressing, À vendre): filters in the address, infinite scroll, a pill and
 * a « … » menu on each card. « Sélectionner » turns each card into a toggle and brings the selection bar; « Terminé »
 * (or Escape) leaves the mode and forgets the selection (spec §3.4).
 */
export function WardrobeView({ view }: { view: ViewKey }) {
  const t = useTranslations("Views");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const ready = useProfilesReady();
  const current = useCurrentProfile();

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
  const query = useMemo(() => {
    const base = toItemQuery(view, filters, current.id);
    return queryListId ? { ...base, wishlist: queryListId } : base;
  }, [view, filters, current.id, queryListId]);
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
  // « Mes envies »: her lists and every wish she has at « Repéré » (counts of the tabs, total of the ticked wishes).
  const [wishes, setWishes] = useState<ItemView[]>([]);
  const [wishesError, setWishesError] = useState(false);
  const [scopeToken, setScopeToken] = useState(0);
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
    const wanted: Record<string, string> = { stage: "spotted" };
    if (current.id) wanted.profile = current.id;
    fetchAllWishes(wanted).then(
      (items) => !stale && setWishes(items),
      () => !stale && setWishesError(true),
    );
    return () => {
      stale = true;
    };
  }, [view, ready, current.id, reloadToken, scopeToken]);
  // Another profile: its wishes are not those on screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: cleared when the profile changes.
  useEffect(() => setWishes([]), [current.id]);

  // First page, again whenever the view, the filters, the profile or the reload token change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: queryKey stands for query.
  useEffect(() => {
    if (!ready || listPending) return;
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
  }, [queryKey, ready, reloadToken, listPending]);

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

  const setFilters = (next: ViewFilters) => {
    const params = filtersToParams(next, new URLSearchParams(search.toString()));
    const text = paramsText(params);
    router.push(text ? `${pathname}?${text}` : pathname, { scroll: false });
  };

  const reload = useCallback(async () => setReloadToken((value) => value + 1), []);

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
    ready && !selecting && data.status === "ready",
  );
  const gone = useCallback((ids: readonly string[]) => {
    const away = new Set(ids);
    setData((previous) => ({ ...previous, items: previous.items.filter((item) => !away.has(item.id)) }));
    setWishes((previous) => previous.filter((item) => !away.has(item.id)));
  }, []);

  // A card changed from its pill or its « … » menu: kept while it still belongs to the view and its filters.
  const viewStage = filters.stage ?? VIEWS[view].stage;
  const { tag, levels, priority } = filters;
  const levelsKey = levels?.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: levelsKey stands for levels.
  const changed = useCallback(
    (item: ItemView) => {
      setWishes((previous) =>
        item.stage === "spotted"
          ? previous.map((known) => (known.id === item.id ? item : known))
          : previous.filter((known) => known.id !== item.id),
      );
      const stays = stillShown(item, viewStage, current.id, { tag, levels, priority });
      setData((previous) => ({
        ...previous,
        items: stays
          ? previous.items.map((known) => (known.id === item.id ? item : known))
          : previous.items.filter((known) => known.id !== item.id),
      }));
    },
    [viewStage, current.id, tag, levelsKey, priority],
  );
  const trashed = useCallback((id: string) => gone([id]), [gone]);
  const actions = useMemo(() => ({ onChanged: changed, onTrashed: trashed, reload }), [changed, trashed, reload]);

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
  const scopeWishes = useMemo(() => {
    if (!listId) return wishes;
    const inList = new Set(activeList?.itemIds ?? []);
    return wishes.filter((item) => inList.has(item.id));
  }, [wishes, listId, activeList]);
  const draftCents = draftTotals(scopeWishes, null).totalCents;
  const budgetScope: BudgetScope | null = listId
    ? { wishlistId: listId }
    : current.id
      ? { profileId: current.id }
      : null;
  const tabs = useMemo(
    () =>
      lists.items.map((list) => {
        const inList = new Set(list.itemIds);
        return { list, count: wishes.filter((item) => inList.has(item.id)).length };
      }),
    [lists.items, wishes],
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

  return (
    <div className="flex flex-col gap-space-4 pb-space-6">
      <div className="flex flex-wrap items-center justify-between gap-space-3">
        <h1 className="font-display text-title font-strong">{label}</h1>
        <div className="flex flex-wrap gap-space-2">
          {view === "envies" && !filters.stage && !selecting && (
            <Link href={orderHref} className={`${buttonClass} ${touch}`}>
              {t("prepareOrder")}
            </Link>
          )}
          {(selecting || data.items.length > 0) && (
            <button
              type="button"
              className={`${selecting ? primaryButtonClass : buttonClass} ${touch}`}
              onClick={() => (selecting ? leaveSelection() : setSelecting(true))}
            >
              {selecting ? t("selection.done") : t("selection.start")}
            </button>
          )}
        </div>
      </div>
      {view === "envies" && <ListTabs lists={tabs} current={listId} allCount={wishes.length} onChange={chooseList} />}
      {view === "envies" && budgetScope && (!listId || activeList) && (
        <BudgetCard
          scope={budgetScope}
          draftCents={draftCents}
          listName={activeList?.name}
          reloadKey={reloadToken + scopeToken}
        />
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
      <FiltersBar
        filters={filters}
        onChange={setFilters}
        shops={shops}
        tags={tags}
        reference={reference}
        activeCount={count}
      />

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
      {(data.status === "loading" || !ready) && data.items.length === 0 && (
        <p role="status" className="text-ink-muted">
          {t("loading")}
        </p>
      )}

      {isEmpty && (
        <section className="flex flex-col items-start gap-space-3 rounded-card border border-line bg-surface-raised p-space-5">
          {count > 0 ? (
            <>
              <h2 className="font-display text-lead font-strong">{t("empty.filtered.title")}</h2>
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
              <h2 className="font-display text-lead font-strong">{t(`empty.${view}.title`)}</h2>
              <p className="max-w-measure text-ink-muted">{t(`empty.${view}.body`)}</p>
              <Link href="/" className={`${primaryButtonClass} ${touch}`}>
                {t("empty.action")}
              </Link>
            </>
          )}
        </section>
      )}

      {data.items.length > 0 && (
        <ItemGrid
          label={label}
          items={data.items}
          actions={actions}
          selection={selection}
          showStage={filters.stage !== undefined}
        >
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
          currentStage={filters.stage ?? VIEWS[view].stage}
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
    </div>
  );
}
