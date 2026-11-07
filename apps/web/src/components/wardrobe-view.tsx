"use client";

import type { ItemView, ReferenceView, TagView } from "@closyria/shared";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useLiveRefresh } from "@/lib/live-changes";
import { profileHref, useCurrentProfile, useProfilesReady } from "@/lib/profile-context";
import { fetchFacets, fetchItemsPage, fetchReference, fetchTags } from "@/lib/wardrobe-client";
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
import { FiltersBar } from "./filters-bar";
import { ItemGrid } from "./item-grid";
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
  const query = useMemo(() => toItemQuery(view, filters, current.id), [view, filters, current.id]);
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

  // First page, again whenever the view, the filters, the profile or the reload token change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: queryKey stands for query.
  useEffect(() => {
    if (!ready) return;
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
  }, [queryKey, ready, reloadToken]);

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
  useLiveRefresh(() => void refreshQuietly(), ready && !selecting && data.status === "ready");
  const gone = useCallback((ids: readonly string[]) => {
    const away = new Set(ids);
    setData((previous) => ({ ...previous, items: previous.items.filter((item) => !away.has(item.id)) }));
  }, []);

  // A card changed from its pill or its « … » menu: kept while it still belongs to the view and its filters.
  const viewStage = filters.stage ?? VIEWS[view].stage;
  const { tag, levels, priority } = filters;
  const levelsKey = levels?.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: levelsKey stands for levels.
  const changed = useCallback(
    (item: ItemView) => {
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

  const count = activeFilterCount(filters);
  const label = t(`title.${view}`);
  const isEmpty = data.status === "ready" && data.items.length === 0;

  return (
    <div className="flex flex-col gap-space-4 pb-space-6">
      <div className="flex flex-wrap items-center justify-between gap-space-3">
        <h1 className="font-display text-title font-strong">{label}</h1>
        <div className="flex flex-wrap gap-space-2">
          {view === "envies" && !filters.stage && !selecting && (
            <Link
              href={profileHref("/envies/commande", current.id, current.isDefault)}
              className={`${buttonClass} ${touch}`}
            >
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
