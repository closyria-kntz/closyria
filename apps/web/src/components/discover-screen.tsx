"use client";

import type { ShopCard, ShopDirectory } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useState } from "react";
import { fetchShopDirectory } from "@/lib/wardrobe-client";
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

function Loading() {
  const t = useTranslations("Discover");
  return (
    <div role="status" aria-label={t("loading")} className="flex flex-col gap-space-4-5">
      <span className="h-control-sm rounded-pill bg-surface-sunken motion-safe:animate-pulse" />
      <div className="aspect-video rounded-card bg-une motion-safe:animate-pulse" />
    </div>
  );
}

/** Her search on the shops' name or domain (mockup .srch). */
function Search({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useTranslations("Discover.search");
  const fieldId = useId();
  return (
    <search
      aria-label={t("label")}
      className="relative isolate flex h-control-sm w-full min-w-space-0 items-center rounded-pill bg-surface-strong pl-space-3 sm:h-control-plus lg:max-w-panel"
    >
      <label htmlFor={fieldId} className="hit-area-under flex shrink-0 text-ink-muted">
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
          className="size-space-4"
        >
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5L14 14" />
        </svg>
        <span className="sr-only">{t("label")}</span>
      </label>
      <input
        id={fieldId}
        type="search"
        value={value}
        maxLength={120}
        placeholder={t("placeholder")}
        onChange={(event) => onChange(event.target.value)}
        className={`min-w-space-0 flex-1 self-stretch rounded-pill bg-transparent px-space-2 text-ui text-ink placeholder:text-ink-muted ${focusRing}`}
      />
    </search>
  );
}

/**
 * « Découvrir » (refonte Boudoir, spec §6, validated on 2026-11-11): until the catalogue comes, the shops Closyria
 * knows — « La boutique de la semaine » an admin puts forward as the une, then every shop (photo, name, domain, how
 * many articles), each opening its site in a new tab. Her search filters them by name or domain, the une among them.
 */
export function DiscoverScreen() {
  const t = useTranslations("Discover");
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [query, setQuery] = useState("");
  const gridTitleId = useId();

  useEffect(() => {
    let live = true;
    fetchShopDirectory()
      .then((directory) => live && setLoaded({ status: "ready", directory }))
      .catch(() => live && setLoaded({ status: "error" }));
    return () => {
      live = false;
    };
  }, []);

  const head = (
    <div className="flex flex-col gap-space-1">
      <span className={kickerClass}>{t("kicker")}</span>
      <h1 className="font-title text-page-title leading-none font-regular">{t("title")}</h1>
    </div>
  );

  let body: ReactNode;
  if (loaded.status === "loading") body = <Loading />;
  else if (loaded.status === "error") {
    body = (
      <p role="alert" className="text-ink-muted">
        {t("loadError")}
      </p>
    );
  } else {
    const { featured, shops } = loaded.directory;
    const searching = query.trim() !== "";
    const all = featured ? [featured, ...shops] : shops;
    const shown = searching ? matchShops(all, query) : shops;
    body =
      all.length === 0 ? (
        <p className="max-w-measure rounded-card bg-surface-sunken p-space-4 text-ink-muted">{t("empty")}</p>
      ) : (
        <>
          <Search value={query} onChange={setQuery} />
          <p role="status" className="sr-only">
            {searching ? t("results", { count: shown.length }) : ""}
          </p>
          {featured && !searching && <Une shop={featured} />}
          <section aria-labelledby={gridTitleId} className="flex flex-col gap-space-2-5">
            <h2 id={gridTitleId} className="font-title text-section-title leading-tight font-regular">
              {t("all")}
            </h2>
            {shown.length === 0 ? (
              <p className="text-ink-muted">{t("noMatch", { query: query.trim() })}</p>
            ) : (
              <ul className="grid grid-cols-2 gap-space-3 md:grid-cols-3 lg:grid-cols-5 lg:gap-space-4">
                {shown.map((shop) => (
                  <ShopTile key={shop.id} shop={shop} />
                ))}
              </ul>
            )}
          </section>
        </>
      );
  }

  return (
    <div className="flex flex-col gap-space-4-5 pt-space-2 pb-space-6">
      {head}
      {body}
    </div>
  );
}
