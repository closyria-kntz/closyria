"use client";

import type { CatalogCard, ReferenceView, ShopCard, ShopDirectory } from "@closyria/shared";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  activeCatalogueFilterCount,
  type CatalogueFilters,
  catalogueFiltersFromParams,
  catalogueFiltersToParams,
  fetchCataloguePage,
  snapshotKey,
  toCatalogueQuery,
} from "@/lib/catalogue-client";
import { useCurrentProfile, useProfilesReady } from "@/lib/profile-context";
import { fetchReference, fetchShopDirectory } from "@/lib/wardrobe-client";
import { paramsText } from "@/lib/wardrobe-view";
import { useSheetHref } from "./catalogue-card";
import { ActiveFilterChips, CatalogueFiltersMenu, CatalogueSearch, type FiltersChange } from "./catalogue-filters";
import { CatalogueSection } from "./catalogue-grid";
import { FilterChips } from "./filters-bar";
import { focusRing, primaryButtonClass } from "./ui";

type Loaded = { status: "loading" } | { status: "error" } | { status: "ready"; directory: ShopDirectory };

const kickerClass = "text-meta font-bold tracking-wide text-une-ink uppercase";

/** The shop's site, opened in a new tab. */
export const shopSite = (shop: ShopCard) => `https://${shop.domain}`;

/** Lower case, without accents: « Zéphyr » is found by « zephyr », « ZEPHYR »… */
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** The shops whose name or domain holds the words she typed. */
export function matchShops(shops: readonly ShopCard[], query: string): ShopCard[] {
  const words = fold(query).trim();
  if (!words) return [...shops];
  return shops.filter((shop) => fold(`${shop.name} ${shop.domain}`).includes(words));
}

/** One recent photo of the shop, or its initial on the soft tone when Closyria has none (mockup .shopcard img). */
export function ShopPhoto({ shop, className }: { shop: ShopCard; className: string }) {
  if (shop.imageUrl) {
    // biome-ignore lint/performance/noImgElement: photos come from our own API, already resized.
    return <img src={shop.imageUrl} alt="" decoding="async" loading="lazy" className={`${className} object-cover`} />;
  }
  return (
    <span
      aria-hidden="true"
      className={`${className} grid place-items-center bg-surface-sunken font-title text-page-title text-une-ink`}
    >
      {shop.name.charAt(0).toUpperCase()}
    </span>
  );
}

/** « La boutique de la semaine » (mockup .une): the photo on the left, the powder-pink panel and « Voir la boutique ». */
function Une({ shop }: { shop: ShopCard }) {
  const t = useTranslations("Discover");
  const titleId = useId();
  return (
    <article
      aria-labelledby={titleId}
      className="grid grid-cols-(--grid-une) overflow-hidden rounded-card bg-une text-ink lg:grid-cols-(--grid-une-wide)"
    >
      <ShopPhoto shop={shop} className="aspect-3/4 size-full" />
      <div className="flex min-w-space-0 flex-col justify-center gap-space-1-5 p-space-3-5 lg:p-space-5">
        <span className={kickerClass}>{t("une.kicker")}</span>
        <h2 id={titleId} className="font-title text-une-title leading-tight font-regular break-words">
          {shop.name}
        </h2>
        <p className="text-chip">
          {shop.domain} · {t("count", { count: shop.itemCount })}
        </p>
        <a
          href={shopSite(shop)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${primaryButtonClass} mt-space-1 min-h-touch-target self-start`}
        >
          {t("une.open")}
          <span className="sr-only"> {t("newTab")}</span>
        </a>
      </div>
    </article>
  );
}

/** A shop of the grid (mockup .shopcard): photo, name, domain and how many articles; opens its site. */
function ShopTile({ shop }: { shop: ShopCard }) {
  const t = useTranslations("Discover");
  return (
    <li className="flex min-w-space-0">
      <a
        href={shopSite(shop)}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex w-full min-w-space-0 flex-col overflow-hidden rounded-card bg-surface-raised ${focusRing}`}
      >
        <ShopPhoto shop={shop} className="aspect-square w-full" />
        <span className="flex min-w-space-0 flex-col gap-space-0-5 px-space-2-5 py-space-2 text-meta">
          <b className="truncate text-sm">{shop.name}</b>
          <span className="truncate text-ink-muted">{shop.domain}</span>
          <span className="text-ink-muted">{t("count", { count: shop.itemCount })}</span>
          <span className="sr-only">{t("newTab")}</span>
        </span>
      </a>
    </li>
  );
}

/**
 * « Nouveautés de la semaine »: the une when no shop is put forward (spec §3.1), in the same shape (photo on the left,
 * the powder-pink panel): the newest article's photo, and « Voir les nouveautés » turns the « Nouveautés » filter on.
 */
function NewArrivalsUne({ card, onOpen }: { card: CatalogCard; onOpen: () => void }) {
  const t = useTranslations("Discover.une");
  const titleId = useId();
  const sheetHref = useSheetHref();
  return (
    <article
      aria-labelledby={titleId}
      className="grid grid-cols-(--grid-une) overflow-hidden rounded-card bg-une text-ink lg:grid-cols-(--grid-une-wide)"
    >
      <Link href={sheetHref(card.productId)} className={`block ${focusRing}`}>
        {/* biome-ignore lint/performance/noImgElement: photos come from our own API, already resized. */}
        <img src={card.imageUrl} alt={card.name} decoding="async" className="aspect-3/4 size-full object-cover" />
      </Link>
      <div className="flex min-w-space-0 flex-col justify-center gap-space-1-5 p-space-3-5 lg:p-space-5">
        <span className={kickerClass}>{t("newKicker")}</span>
        <h2 id={titleId} className="font-title text-une-title leading-tight font-regular break-words">
          {t("newTitle")}
        </h2>
        <p className="text-chip">{t("newBody")}</p>
        <button
          type="button"
          onClick={onOpen}
          className={`${primaryButtonClass} mt-space-1 min-h-touch-target self-start`}
        >
          {t("newOpen")}
        </button>
      </div>
    </article>
  );
}

function Loading() {
  const t = useTranslations("Discover");
  return (
    <div role="status" aria-label={t("loading")} className="flex flex-col gap-space-4-5">
      <div className="aspect-video rounded-card bg-une motion-safe:animate-pulse" />
    </div>
  );
}

type NewArrival = { status: "idle" | "loading" | "ready"; card: CatalogCard | null };

/**
 * « Découvrir » (refonte Boudoir, spec §6; catalogue, spec 2026-11-13 §3.1): her search and « Filtres et tri » (in the
 * address, so the back button gives them back) with the filters on as chips; the une — « La boutique de la semaine »
 * an admin puts forward, else « Nouveautés de la semaine » — while no filter is on; the catalogue's articles; and lower
 * down every shop Closyria knows (photo, name, domain, how many articles), each opening its site in a new tab. The
 * search also filters the shops by name or domain.
 */
export function DiscoverScreen() {
  const t = useTranslations("Discover");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const ready = useProfilesReady();
  const current = useCurrentProfile();
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [reference, setReference] = useState<ReferenceView | null>(null);
  const [hasSizes, setHasSizes] = useState<boolean | null>(null);
  const [newArrival, setNewArrival] = useState<NewArrival>({ status: "idle", card: null });
  const gridTitleId = useId();

  const searchText = search.toString();
  const filters = useMemo(() => catalogueFiltersFromParams(new URLSearchParams(searchText)), [searchText]);
  const query = useMemo(() => toCatalogueQuery(filters, current.id), [filters, current.id]);
  const key = snapshotKey(new URLSearchParams(searchText));
  const count = activeCatalogueFilterCount(filters, hasSizes);
  const filtered = count > 0;

  useEffect(() => {
    let live = true;
    fetchShopDirectory()
      .then((directory) => live && setLoaded({ status: "ready", directory }))
      .catch(() => live && setLoaded({ status: "error" }));
    fetchReference().then(
      (found) => live && setReference(found),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  // « Nouveautés de la semaine »: read only when no shop of the week is put forward.
  const featured = loaded.status === "ready" ? loaded.directory.featured : null;
  const needsNew = loaded.status === "ready" && !featured && ready;
  useEffect(() => {
    if (!needsNew) return;
    const controller = new AbortController();
    setNewArrival({ status: "loading", card: null });
    fetchCataloguePage(toCatalogueQuery({ isNew: true }, current.id), null, undefined, controller.signal).then(
      (page) => setNewArrival({ status: "ready", card: page.items[0] ?? null }),
      () => !controller.signal.aborted && setNewArrival({ status: "ready", card: null }),
    );
    return () => controller.abort();
  }, [needsNew, current.id]);

  // The filters of the last change, ahead of the address (the router writes it a moment later): a second quick change
  // starts from it.
  const latest = useRef(filters);
  useEffect(() => {
    latest.current = filters;
  }, [filters]);
  const setFilters = useCallback(
    (next: CatalogueFilters, replace = false) => {
      latest.current = next;
      const params = catalogueFiltersToParams(next, new URLSearchParams(window.location.search));
      const text = paramsText(params);
      const href = text ? `${pathname}?${text}` : pathname;
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [pathname, router],
  );
  const change = useCallback((update: FiltersChange) => setFilters(update(latest.current)), [setFilters]);
  const clear = useCallback(() => {
    const { sort } = latest.current;
    setFilters(sort ? { sort } : {});
  }, [setFilters]);

  const shopsOfFilter = useMemo(() => {
    if (loaded.status !== "ready") return [];
    const { featured: one, shops } = loaded.directory;
    return (one ? [one, ...shops] : shops)
      .map((shop) => ({ id: shop.id, name: shop.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [loaded]);

  // What stands above the grid is drawn (the kept position can be given back).
  const aboveReady =
    loaded.status !== "loading" && (filtered || featured !== null || !needsNew || newArrival.status === "ready");

  const head = (
    <div className="flex flex-col gap-space-1">
      <span className={kickerClass}>{t("kicker")}</span>
      <h1 className="font-title text-page-title leading-none font-regular">{t("title")}</h1>
    </div>
  );

  const tools = (
    <div className="flex flex-col gap-space-3">
      {/* Positioned: the filters panel opens against this row. */}
      <div className="relative flex items-center gap-space-2">
        <CatalogueSearch
          value={filters.q}
          onChange={(q) => setFilters(q ? { ...latest.current, q } : withoutQ(latest.current), true)}
        />
        <CatalogueFiltersMenu
          filters={filters}
          onChange={change}
          shops={shopsOfFilter}
          reference={reference}
          hasSizes={hasSizes}
        />
      </div>
      <ActiveFilterChips
        filters={filters}
        onChange={change}
        shops={shopsOfFilter}
        reference={reference}
        hasSizes={hasSizes}
      />
      <FilterChips activeCount={count} onClearAll={clear} />
    </div>
  );

  let une: ReactNode = null;
  if (!filtered) {
    if (loaded.status === "loading") une = <Loading />;
    else if (featured) une = <Une shop={featured} />;
    else if (newArrival.card)
      une = <NewArrivalsUne card={newArrival.card} onOpen={() => setFilters({ isNew: true })} />;
  }

  let shopsBlock: ReactNode = null;
  if (loaded.status === "error") {
    shopsBlock = (
      <p role="alert" className="text-ink-muted">
        {t("loadError")}
      </p>
    );
  } else if (loaded.status === "ready") {
    const { shops } = loaded.directory;
    const searching = Boolean(filters.q);
    const all = featured ? [featured, ...shops] : shops;
    const shown = searching ? matchShops(all, filters.q ?? "") : shops;
    shopsBlock =
      all.length === 0 ? (
        <p className="max-w-measure rounded-card bg-surface-sunken p-space-4 text-ink-muted">{t("empty")}</p>
      ) : (
        <section aria-labelledby={gridTitleId} className="flex flex-col gap-space-2-5">
          <p role="status" className="sr-only">
            {searching ? t("results", { count: shown.length }) : ""}
          </p>
          <h2 id={gridTitleId} className="font-title text-section-title leading-tight font-regular">
            {t("all")}
          </h2>
          {shown.length === 0 ? (
            <p className="text-ink-muted">{t("noMatch", { query: filters.q ?? "" })}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-space-3 md:grid-cols-3 lg:grid-cols-5 lg:gap-space-4">
              {shown.map((shop) => (
                <ShopTile key={shop.id} shop={shop} />
              ))}
            </ul>
          )}
        </section>
      );
  }

  return (
    <div className="flex flex-col gap-space-4-5 pt-space-2 pb-space-6">
      {head}
      {tools}
      {une}
      <CatalogueSection
        query={query}
        snapshotKey={key}
        ready={ready}
        aboveReady={aboveReady}
        filtered={filtered}
        onClear={clear}
        onHasSizes={setHasSizes}
      />
      {shopsBlock}
    </div>
  );
}

const withoutQ = ({ q: _, ...rest }: CatalogueFilters): CatalogueFilters => rest;
