"use client";

import type { CatalogCard } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { scrollerOf } from "@/components/back-to-top";
import { sectionTitleClass } from "@/components/home-news";
import { buttonClass, primaryButtonClass } from "@/components/ui";
import {
  fetchCataloguePage,
  reachedByHistory,
  readSnapshot,
  sessionStorageOrNull,
  writeSnapshot,
} from "@/lib/catalogue-client";
import { CatalogueGrid } from "./catalogue-card";

type Loaded = {
  status: "loading" | "ready" | "error";
  items: CatalogCard[];
  nextCursor: string | null;
};

const touch = "min-h-touch-target";
/** How many frames a given-back position is held against a jump to the top. */
const KEEP_SCROLL_FRAMES = 30;
/** The position is written this long after she stopped scrolling. */
const SCROLL_SAVE_MS = 200;

/**
 * The catalogue's articles for the filters of the address (spec §3.1): 24 at a time, « Voir plus d’articles » for the
 * next ones (the shops' row stays reachable under the grid), « Aucun article avec ces filtres. » and « Effacer les
 * filtres » when nothing matches. What she loaded and where she was are kept for the address (`snapshotKey`), so the
 * back button from a sheet gives back the same pages at the same place; those pages are then read again quietly (her
 * « Je le veux » on the sheet shows).
 */
export function CatalogueSection({
  query,
  snapshotKey,
  ready,
  aboveReady,
  filtered,
  onClear,
  onHasSizes,
}: {
  /** `GET /api/catalog`'s query (filters, sort, profile). */
  query: Record<string, string>;
  /** The address' key: the snapshot of another address is never given back. */
  snapshotKey: string;
  /** False until her profiles are read (the query names one). */
  ready: boolean;
  /** True once what stands above the grid is drawn: the kept position is given back only then. */
  aboveReady: boolean;
  /** Whether any filter is on (the empty screen offers to clear them). */
  filtered: boolean;
  onClear: () => void;
  onHasSizes: (hasSizes: boolean) => void;
}) {
  const t = useTranslations("Discover.catalogue");
  const titleId = "catalogue-title";
  const [data, setData] = useState<Loaded>({ status: "loading", items: [], nextCursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const hasSizes = useRef<boolean | null>(null);
  const pendingScroll = useRef<number | null>(null);
  const section = useRef<HTMLElement>(null);
  const holdFrame = useRef(0);
  const generation = useRef(0);
  const told = useRef(onHasSizes);
  told.current = onHasSizes;
  const queryKey = JSON.stringify(query);
  // Read once, as the page arrives: the back button gives back the kept pages of the address it came back to (again
  // when her profile is read meanwhile), not a later change of filters.
  const returning = useRef<boolean | null>(null);
  if (returning.current === null && typeof window !== "undefined") returning.current = reachedByHistory();
  const arrivedAt = useRef(snapshotKey);
  // The router may draw the page inside the back button's own event, before that event is told (browsers without the
  // Navigation API): asked again just after.
  useEffect(() => {
    if (returning.current) return;
    const timer = setTimeout(() => {
      if (!reachedByHistory()) return;
      returning.current = true;
      setReloadToken((n) => n + 1);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const learnSizes = useCallback((value: boolean) => {
    hasSizes.current = value;
    told.current(value);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: queryKey stands for query; reloadToken re-reads.
  useEffect(() => {
    if (!ready) return;
    void reloadToken;
    const mine = ++generation.current;
    const controller = new AbortController();
    setLoadingMore(false);
    setMoreFailed(false);
    const store = sessionStorageOrNull();
    // Once she changed the address (filters), the kept pages are no longer hers to get back.
    if (snapshotKey !== arrivedAt.current) returning.current = false;
    const kept = store && returning.current ? readSnapshot(store, snapshotKey, Date.now()) : null;
    if (kept && kept.items.length > 0) {
      // The back button: the same pages at once, the position once drawn; then the same pages read again quietly.
      setData({ status: "ready", items: kept.items, nextCursor: kept.nextCursor });
      learnSizes(kept.hasSizes);
      pendingScroll.current = kept.scrollY;
      void (async () => {
        const items: CatalogCard[] = [];
        let cursor: string | null = null;
        try {
          do {
            const page = await fetchCataloguePage(query, cursor, undefined, controller.signal);
            if (mine !== generation.current) return;
            items.push(...page.items);
            cursor = page.nextCursor;
            learnSizes(page.hasSizes);
          } while (cursor && items.length < kept.items.length);
          setData({ status: "ready", items, nextCursor: cursor });
        } catch {
          // Kept as it was: the next visit reads again.
        }
      })();
    } else {
      pendingScroll.current = null;
      setData({ status: "loading", items: [], nextCursor: null });
      fetchCataloguePage(query, null, undefined, controller.signal).then(
        (page) => {
          if (mine !== generation.current) return;
          learnSizes(page.hasSizes);
          setData({ status: "ready", items: page.items, nextCursor: page.nextCursor });
        },
        () => mine === generation.current && setData({ status: "error", items: [], nextCursor: null }),
      );
    }
    return () => controller.abort();
  }, [queryKey, snapshotKey, ready, reloadToken, learnSizes]);

  // The kept position, once the pages and what stands above them are drawn.
  useLayoutEffect(() => {
    if (pendingScroll.current === null || data.status !== "ready" || !aboveReady) return;
    const top = pendingScroll.current;
    pendingScroll.current = null;
    const scroller = scrollerOf(section.current);
    scroller.scrollTo({ top, behavior: "instant" });
    // The shell sends a page reached back to the top as it arrives, sometimes just after this: for a few frames, a
    // jump back to the top is undone (her own scrolling is left alone).
    let frames = 0;
    holdFrame.current = requestAnimationFrame(function keep() {
      if (scroller.scrollTop === 0 && top > 0) scroller.scrollTo({ top, behavior: "instant" });
      if (++frames < KEEP_SCROLL_FRAMES) holdFrame.current = requestAnimationFrame(keep);
    });
  }, [data, aboveReady]);
  useEffect(() => () => cancelAnimationFrame(holdFrame.current), []);

  // What she loaded and where she is, kept for the back button: at each change, and as she scrolls.
  const save = useCallback(() => {
    const store = sessionStorageOrNull();
    if (!store || data.status !== "ready" || data.items.length === 0 || pendingScroll.current !== null) return;
    writeSnapshot(store, {
      key: snapshotKey,
      items: data.items,
      nextCursor: data.nextCursor,
      hasSizes: hasSizes.current ?? false,
      scrollY: Math.max(0, scrollerOf(section.current).scrollTop),
      savedAt: Date.now(),
    });
  }, [data, snapshotKey]);
  useEffect(() => {
    save();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(save, SCROLL_SAVE_MS);
    };
    // A click on a link (a card, « Voir les articles de … ») saves at once: the next page may come before the pause.
    const onClick = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest?.("a")) save();
    };
    // The app's content area scrolls (the window, on a page of its own); it tells it on the window then.
    const scroller = scrollerOf(section.current);
    const target: HTMLElement | Window = scroller === document.scrollingElement ? window : scroller;
    target.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onClick, true);
    return () => {
      clearTimeout(timer);
      target.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onClick, true);
    };
  }, [save]);

  async function loadMore() {
    if (!data.nextCursor || loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const page = await fetchCataloguePage(query, data.nextCursor);
      if (mine !== generation.current) return;
      setData((previous) => {
        const known = new Set(previous.items.map((item) => item.productId));
        return {
          ...previous,
          items: [...previous.items, ...page.items.filter((item) => !known.has(item.productId))],
          nextCursor: page.nextCursor,
        };
      });
    } catch {
      if (mine === generation.current) setMoreFailed(true);
    } finally {
      if (mine === generation.current) setLoadingMore(false);
    }
  }

  const onWanted = useCallback((productId: string, wanted: boolean) => {
    setData((previous) => ({
      ...previous,
      items: previous.items.map((item) => (item.productId === productId ? { ...item, wanted } : item)),
    }));
  }, []);

  let body: React.ReactNode;
  if (data.status === "error") {
    body = (
      <div className="flex flex-col items-start gap-space-2">
        <p role="alert" className="text-sm text-danger">
          {t("loadError")}
        </p>
        <button type="button" className={`${buttonClass} ${touch}`} onClick={() => setReloadToken((n) => n + 1)}>
          {t("retry")}
        </button>
      </div>
    );
  } else if (data.status === "loading" || !ready) {
    body = (
      <p role="status" className="text-ink-muted">
        {t("loading")}
      </p>
    );
  } else if (data.items.length === 0) {
    body = filtered ? (
      <div className="flex flex-col items-start gap-space-3 rounded-card bg-surface-sunken p-space-5">
        <h3 className="font-title text-lead font-regular">{t("empty")}</h3>
        <p className="max-w-measure text-ink-muted">{t("emptyBody")}</p>
        <button type="button" className={`${primaryButtonClass} ${touch}`} onClick={onClear}>
          {t("clear")}
        </button>
      </div>
    ) : (
      <p className="max-w-measure rounded-card bg-surface-sunken p-space-4 text-ink-muted">{t("none")}</p>
    );
  } else {
    body = (
      <>
        <CatalogueGrid label={t("title")} cards={data.items} onWanted={onWanted} />
        <p role="status" className="sr-only">
          {t("count", { count: data.items.length })}
        </p>
        {data.nextCursor && (
          <div className="flex flex-col items-center gap-space-2">
            {moreFailed && (
              <p role="alert" className="text-sm text-danger">
                {t("loadError")}
              </p>
            )}
            <button
              type="button"
              disabled={loadingMore}
              className={`${buttonClass} ${touch} justify-center px-space-5 font-strong disabled:opacity-60`}
              onClick={() => void loadMore()}
            >
              {loadingMore ? t("loadingMore") : t("more")}
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <section ref={section} aria-labelledby={titleId} className="flex flex-col gap-space-2-5">
      <h2 id={titleId} className={sectionTitleClass}>
        {t("title")}
      </h2>
      {body}
    </section>
  );
}
