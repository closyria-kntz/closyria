"use client";

import type { HomeView, ShopCard } from "@closyria/shared";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useId, useState } from "react";
import { ARTICLES_PATH, STEP_PARAM } from "@/lib/articles-address";
import { useLiveRefresh } from "@/lib/live-changes";
import { useDesktop } from "@/lib/use-desktop";
import { fetchHome, fetchShopDirectory } from "@/lib/wardrobe-client";
import { CaptureForm } from "./capture-form";
import { ShopPhoto, shopSite } from "./discover-screen";
import { HomeNewsList, moreClass, sectionTitleClass } from "./home-news";
import { HomeUne } from "./home-une";
import { ItemCard } from "./item-card";
import { GRID_CLASS } from "./item-grid";
import { RecentProducts } from "./recent-products";
import { Tip } from "./tip";
import { blockClass, focusRing } from "./ui";

type Loaded = { status: "loading" } | { status: "error" } | { status: "ready"; home: HomeView; now: Date };

/** « Boutiques à découvrir »: at most this many shops. */
const HOME_SHOPS = 4;

const kickerClass = "text-meta font-bold tracking-wide text-une-ink uppercase";

/** « Bonjour Camille » over the page's title (mockup .k + .t1). */
function Hello({ name, title }: { name: string | null; title: string }) {
  const t = useTranslations("Home");
  return (
    <div className="flex flex-col gap-space-1">
      <span className={kickerClass}>{name ? t("greeting", { name }) : t("greetingNoName")}</span>
      <h1 className="font-title text-page-title leading-none font-regular">{title}</h1>
    </div>
  );
}

/** The burgundy add box (mockup .addbox): her paste field, the same capture as « Coller un lien ». */
function AddBox({ fieldId }: { fieldId: string }) {
  const t = useTranslations("Home.add");
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-space-2-5 rounded-card bg-band p-space-4 text-band-ink"
    >
      <h2 id={titleId} className={sectionTitleClass}>
        {t("title")}
      </h2>
      <CaptureForm fieldId={fieldId} look="box" />
    </section>
  );
}

/**
 * While her home loads: the shapes of the title, the une and the add box (no field yet: what she typed would be lost
 * when the real page replaces it), never an empty screen.
 */
function Loading() {
  const t = useTranslations("Home");
  const bar = "rounded-pill bg-surface-sunken motion-safe:animate-pulse";
  return (
    <div role="status" aria-label={t("loading")} className="flex flex-col gap-space-4-5">
      <div className="flex flex-col gap-space-2">
        <span className={`${bar} h-space-3 w-1/4`} />
        <span className={`${bar} h-space-7 w-2/3`} />
      </div>
      <div className="aspect-video rounded-card bg-une motion-safe:animate-pulse" />
      <div className="flex flex-col gap-space-3 rounded-card bg-band p-space-4">
        <span className="h-space-5 w-3/4 rounded-pill bg-band-field" />
        <span className="h-space-7 rounded-pill bg-band-field" />
      </div>
    </div>
  );
}

/** A section title with its link on the right (mockup .row). */
function Row({ titleId, title, link }: { titleId: string; title: string; link: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-space-2-5">
      <h2 id={titleId} className={sectionTitleClass}>
        {title}
      </h2>
      {link}
    </div>
  );
}

/**
 * « Boutiques à découvrir » (mockup .shopcard): the shops of « Découvrir », the boutique de la semaine first, four at
 * most, each opening its site in a new tab like there. Hidden when Closyria knows none.
 */
function Shops({ shops }: { shops: ShopCard[] }) {
  const t = useTranslations("Home.shops");
  const tDiscover = useTranslations("Discover");
  const titleId = useId();
  if (shops.length === 0) return null;
  return (
    <section aria-labelledby={titleId} className="flex min-w-space-0 flex-col gap-space-2-5">
      <Row
        titleId={titleId}
        title={t("title")}
        link={
          <Link href="/decouvrir" className={moreClass}>
            {t("all")}
          </Link>
        }
      />
      <ul className="-mx-space-1 flex gap-space-3 overflow-x-auto px-space-1 pb-space-1">
        {shops.map((shop) => (
          <li key={shop.id} className="w-shop-card shrink-0">
            <a
              href={shopSite(shop)}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex flex-col overflow-hidden rounded-card bg-surface-raised ${focusRing}`}
            >
              <ShopPhoto shop={shop} className="aspect-square w-full" />
              <span className="flex flex-col px-space-2-5 py-space-2 text-meta">
                <b className="truncate text-sm">{shop.name}</b>
                <span className="text-ink-muted">{tDiscover("count", { count: shop.itemCount })}</span>
                <span className="sr-only">{tDiscover("newTab")}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** « Tes envies du moment »: up to four of her wishes, and « Mes articles » on the wishes. */
function Wishes({ wishes }: { wishes: HomeView["wishes"] }) {
  const t = useTranslations("Home.wishes");
  const titleId = useId();
  if (wishes.length === 0) return null;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-space-2-5">
      <Row
        titleId={titleId}
        title={t("title")}
        link={
          <Link href={`${ARTICLES_PATH}?${STEP_PARAM}=envie`} className={moreClass}>
            {t("all")}
          </Link>
        }
      />
      <ul aria-labelledby={titleId} className={GRID_CLASS}>
        {wishes.map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}

/** A new account: the add box first, then what Closyria does, in three points (spec R8: an empty screen explains). */
function Start({ fieldId }: { fieldId: string }) {
  const t = useTranslations("Home.start");
  const titleId = useId();
  return (
    <>
      <AddBox fieldId={fieldId} />
      <section aria-labelledby={titleId} className={blockClass}>
        <h2 id={titleId} className={sectionTitleClass}>
          {t("title")}
        </h2>
        <ol className="flex list-inside list-decimal flex-col gap-space-2 marker:font-bold marker:text-une-ink">
          <li>{t("paste")}</li>
          <li>{t("follow")}</li>
          <li>{t("keep")}</li>
        </ol>
      </section>
    </>
  );
}

/**
 * « Accueil » (refonte Boudoir, spec R3): « Bonjour {prénom} » and how many news, the une, « Ce qui a changé », the
 * add box, a tip, « Boutiques à découvrir » and « Tes envies du moment »; « Derniers liens » under them. On a phone in
 * that order; on a computer in two columns (une and wishes on the left, add box, news and tip on the right), the
 * shops under them. A new account sees the add box first and three points that explain what to do.
 */
export function HomeScreen({ fieldId }: { fieldId: string }) {
  const t = useTranslations("Home");
  const desktop = useDesktop();
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [shops, setShops] = useState<ShopCard[]>([]);

  const load = useCallback(async () => {
    try {
      const home = await fetchHome();
      setLoaded({ status: "ready", home, now: new Date() });
      // Only once she keeps something (the row is not on a new account's home): a visit alone opens no session.
      if (!home.hasItems) return;
      const directory = await fetchShopDirectory().catch(() => null);
      if (directory)
        setShops([...(directory.featured ? [directory.featured] : []), ...directory.shops].slice(0, HOME_SHOPS));
    } catch {
      setLoaded((current) => (current.status === "ready" ? current : { status: "error" }));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(() => void load());

  const recents = <RecentProducts emptyFocusId={fieldId} />;
  if (loaded.status === "loading") return <Loading />;
  if (loaded.status === "error") {
    return (
      <div className="flex flex-col gap-space-4-5">
        <h1 className="font-title text-page-title leading-none font-regular">{t("welcome")}</h1>
        <p role="alert" className="text-ink-muted">
          {t("loadError")}
        </p>
        <AddBox fieldId={fieldId} />
        {recents}
      </div>
    );
  }

  const { home, now } = loaded;
  if (!home.hasItems) {
    return (
      <div className="flex flex-col gap-space-4-5">
        <Hello name={home.greetingName} title={t("welcome")} />
        <Start fieldId={fieldId} />
        {recents}
      </div>
    );
  }

  const count = home.news.length + (home.une ? 1 : 0);
  const hello = <Hello name={home.greetingName} title={count > 0 ? t("newsCount", { count }) : t("quiet")} />;
  const une = home.une && <HomeUne news={home.une} />;
  const news = <HomeNewsList news={home.news} now={now} />;
  const add = <AddBox fieldId={fieldId} />;
  const tip = <Tip id="home-levels">{t("tip.levels")}</Tip>;
  const shopsRow = <Shops shops={shops} />;
  const wishes = <Wishes wishes={home.wishes} />;

  if (desktop) {
    return (
      <div className="flex flex-col gap-space-5">
        {hello}
        <div className="grid grid-cols-(--grid-home) items-start gap-space-5">
          <div className="flex min-w-space-0 flex-col gap-space-5">
            {une}
            {wishes}
          </div>
          <div className="flex min-w-space-0 flex-col gap-space-5">
            {add}
            {news}
            {tip}
          </div>
        </div>
        {shopsRow}
        {recents}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-space-4-5">
      {hello}
      {une}
      {news}
      {add}
      {tip}
      {shopsRow}
      {wishes}
      {recents}
    </div>
  );
}
