"use client";

import type { ItemView, ReferenceView, TagView } from "@closyria/shared";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCurrentProfile, useProfilesReady } from "@/lib/profile-context";
import { fetchFacets, fetchItemsPage, fetchReference, fetchTags } from "@/lib/wardrobe-client";
import {
  activeFilterCount,
  filtersFromParams,
  filtersToParams,
  toItemQuery,
  type ViewFilters,
  type ViewKey,
} from "@/lib/wardrobe-view";
import { FiltersBar } from "./filters-bar";
import { ItemGrid } from "./item-grid";
import { SelectionBar } from "./selection-bar";
import { buttonClass, primaryButtonClass } from "./ui";

type Loaded = { items: ItemView[]; nextCursor: string | null; status: "loading" | "ready" | "error" };

const touch = "min-h-touch-target";

/** One of the four views (Envies, Commandé, Dressing, À vendre): filters in the address, infinite scroll, selection. */
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
  const [moreFailed, setMoreFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [shops, setShops] = useState<{ id: string; name: string }[]>([]);
  const [tags, setTags] = useState<TagView[]>([]);
  const [reference, setReference] = useState<ReferenceView | null>(null);
  // Bumped to read the first page again (retry, undo): the effect depends on it.
  const [reloadToken, setReloadToken] = useState(0);
  const generation = useRef(0);
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
    setMoreFailed(false);
    setSelected(new Set());
    fetchItemsPage(query, null, undefined, controller.signal).then(
      (page) =>
        mine === generation.current && setData({ items: page.items, nextCursor: page.nextCursor, status: "ready" }),
      () => mine === generation.current && setData({ items: [], nextCursor: null, status: "error" }),
    );
    return () => controller.abort();
  }, [queryKey, ready, reloadToken]);

  const loadMore = useCallback(async () => {
    if (!data.nextCursor || loadingMore || data.status !== "ready") return;
    const mine = generation.current;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const page = await fetchItemsPage(query, data.nextCursor);
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
      if (mine === generation.current) setMoreFailed(true);
    } finally {
      setLoadingMore(false);
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
    const text = params.toString();
    router.push(text ? `${pathname}?${text}` : pathname, { scroll: false });
  };

  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const reload = useCallback(async () => setReloadToken((value) => value + 1), []);
  const gone = useCallback((ids: readonly string[]) => {
    const away = new Set(ids);
    setData((previous) => ({ ...previous, items: previous.items.filter((item) => !away.has(item.id)) }));
  }, []);

  const count = activeFilterCount(filters);
  const label = t(`title.${view}`);
  const isEmpty = data.status === "ready" && data.items.length === 0;

  return (
    <div className="flex flex-col gap-space-4 pb-space-6">
      <h1 className="font-display text-title font-strong">{label}</h1>
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
          selected={selected}
          onToggle={toggle}
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

      {selected.size > 0 && (
        <SelectionBar
          ids={[...selected]}
          onClear={() => setSelected(new Set())}
          onSelectAll={() => setSelected(new Set(data.items.slice(0, 200).map((item) => item.id)))}
          onGone={gone}
          reload={reload}
        />
      )}
    </div>
  );
}
