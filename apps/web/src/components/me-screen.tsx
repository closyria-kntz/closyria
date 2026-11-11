"use client";

import type { BudgetView, ItemCounts, ItemView } from "@closyria/shared";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, Suspense, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { ARTICLES_PATH, STEP_PARAM } from "@/lib/articles-address";
import { formatAmount } from "@/lib/budget";
import { useLiveRefresh } from "@/lib/live-changes";
import { ProfilesContext, profileHref, useCurrentProfile } from "@/lib/profile-context";
import { fetchBudget, fetchItemCounts, fetchItemsPage } from "@/lib/wardrobe-client";
import { moreClass, sectionTitleClass } from "./home-news";
import { MePlaces } from "./me-places";
import { ThemeButton } from "./theme-button";
import { focusRing } from "./ui";

/** « Mon dressing » shows this many of her pieces (two rows on a phone, one on a computer, as in the mockup). */
const DRESSING_PREVIEW = 6;

type Glance = { counts: ItemCounts; budget: BudgetView | null; dressing: ItemView[] };
type Loaded = { status: "loading" } | { status: "error" } | { status: "ready"; glance: Glance };

const kickerClass = "text-meta font-bold tracking-wide text-accent uppercase";
const tileClass = "flex min-w-space-0 flex-col gap-space-1-5 rounded-card bg-surface-raised p-space-3-5";
const bigClass = "font-title text-stat leading-none font-regular";

/** One tile of « En un coup d'œil » (mockup .tile): its name, a big number, a line under it; a link when it leads somewhere. */
function Tile({
  label,
  big,
  line,
  href,
  testId,
  children,
}: {
  label: string;
  big: string;
  line: string;
  href?: string;
  testId: string;
  children?: ReactNode;
}) {
  const body = (
    <>
      <span className={kickerClass}>{label}</span>
      <span className={bigClass}>{big}</span>
      <span className="text-chip text-ink-muted">{line}</span>
      {children}
    </>
  );
  return (
    <li className="flex min-w-space-0 flex-col" data-testid={testId}>
      {href ? (
        <Link href={href} className={`${tileClass} flex-1 hover:bg-surface-strong ${focusRing}`}>
          {body}
        </Link>
      ) : (
        <div className={`${tileClass} flex-1`}>{body}</div>
      )}
    </li>
  );
}

/** The tile's bar: the share already ordered (its width goes through a custom property, no inline value). */
function SpentBar({ share }: { share: number }) {
  const bar = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    bar.current?.style.setProperty("--spent-share", `${share}%`);
  }, [share]);
  return (
    <span ref={bar} aria-hidden="true" className="mt-space-1 block h-space-1-5 overflow-hidden rounded-pill bg-line">
      <span className="block h-full w-(--spent-share,0) rounded-pill bg-accent" />
    </span>
  );
}

/** The budget tile: what is already ordered over the amount, and the bar (mockup: « 132 € sur 200 € ce mois »). */
function BudgetTile({ budget, href }: { budget: BudgetView | null; href: string }) {
  const t = useTranslations("Me.glance.budget");
  const locale = useLocale();
  if (!budget) return <Tile testId="tile-budget" label={t("label")} big={t("none")} line={t("add")} href={href} />;
  const amount = formatAmount(locale, budget.amountCents);
  if (!budget.current) {
    return <Tile testId="tile-budget" label={t("label")} big={amount} line={t("ended")} href={href} />;
  }
  const spent = budget.current.spentCents;
  const share = Math.min(100, Math.round((spent / budget.amountCents) * 100));
  return (
    <Tile
      testId="tile-budget"
      label={t("label")}
      big={formatAmount(locale, spent)}
      line={t(`of.${budget.period}`, { amount })}
      href={href}
    >
      <SpentBar share={share} />
    </Tile>
  );
}

/** « Mon dressing » (mockup): a few of her pieces, photos only, and « Tout voir ». */
function Dressing({ items, allHref }: { items: ItemView[]; allHref: string }) {
  const t = useTranslations("Me.dressing");
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-space-2-5">
      <div className="flex items-baseline justify-between gap-space-2-5">
        <h2 id={titleId} className={sectionTitleClass}>
          {t("title")}
        </h2>
        <Link href={allHref} className={moreClass}>
          {t("all")}
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="rounded-card bg-surface-sunken p-space-3-5 text-sm text-ink-muted">{t("empty")}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-space-2-5 md:grid-cols-6 md:gap-space-3">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col">
              <Link
                href={`/produits/${item.product.id}`}
                className={`block aspect-3/4 overflow-hidden rounded-card bg-media-backdrop ${focusRing}`}
              >
                {item.coverUrl ? (
                  // biome-ignore lint/performance/noImgElement: photos come from our own API, already resized.
                  <img src={item.coverUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex size-full items-center justify-center p-space-2 text-center text-meta text-ink-muted"
                  >
                    {t("noPhoto")}
                  </span>
                )}
                <span className="sr-only">{item.name?.trim() || t("noName")}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const settingsClass = `inline-flex min-h-touch-target items-center rounded-pill bg-surface-sunken px-space-4 text-ui font-strong hover:bg-surface-strong ${focusRing}`;

/** « Réglages », keeping the chosen profile (read from the address). */
function SettingsLink() {
  const t = useTranslations("Me");
  const { id, isDefault } = useCurrentProfile();
  return (
    <Link href={profileHref("/reglages/profils", id, isDefault)} className={settingsClass}>
      {t("settings")}
    </Link>
  );
}

/**
 * The top of « Moi » (mockup: « Moi » over her first name, « Réglages » on the right). Outside the address-reading
 * part, so the page has its title at once.
 */
export function MeHeader() {
  const t = useTranslations("Me");
  const { account } = useContext(ProfilesContext);
  return (
    <div className="flex items-end justify-between gap-space-3">
      <div className="flex min-w-space-0 flex-col gap-space-1">
        <span className={kickerClass}>{t("kicker")}</span>
        <h1 className="truncate font-title text-page-title leading-none font-regular">
          {account?.firstName ?? t("noName")}
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-space-1">
        <ThemeButton />
        <Suspense
          fallback={
            <Link href="/reglages/profils" className={settingsClass}>
              {t("settings")}
            </Link>
          }
        >
          <SettingsLink />
        </Suspense>
      </div>
    </div>
  );
}

/**
 * « Moi » (refonte Boudoir, spec R6, mockup moi()): « Moi » over her first name, « Réglages »; four tiles (Dressing, À
 * vendre, Commandes « Bientôt » until chantier 3, Budget); the return dates to come; a few pieces of « Mon dressing »;
 * then every page the old list gave. Counts and budget are the current profile's, like « Mes articles ».
 */
export function MeScreen() {
  const t = useTranslations("Me");
  const { ready } = useContext(ProfilesContext);
  const { id: profileId, isDefault } = useCurrentProfile();
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const glanceId = useId();
  const href = (path: string) => profileHref(path, profileId, isDefault);
  const stepHref = (step: string) => href(`${ARTICLES_PATH}?${STEP_PARAM}=${step}`);

  const load = useCallback(async () => {
    if (!ready) return;
    try {
      const [counts, budget, page] = await Promise.all([
        fetchItemCounts(profileId),
        profileId ? fetchBudget({ profileId }) : Promise.resolve(null),
        fetchItemsPage({ stage: "owned", received: "false", ...(profileId ? { profile: profileId } : {}) }, null),
      ]);
      setLoaded({ status: "ready", glance: { counts, budget, dressing: page.items.slice(0, DRESSING_PREVIEW) } });
    } catch {
      setLoaded((current) => (current.status === "ready" ? current : { status: "error" }));
    }
  }, [ready, profileId]);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(() => void load());

  return (
    <div className="flex flex-col gap-space-4-5">
      <section aria-labelledby={glanceId} className="flex flex-col gap-space-2-5">
        <h2 id={glanceId} className="sr-only">
          {t("glance.title")}
        </h2>
        {loaded.status === "error" && (
          <p role="alert" className="text-ink-muted">
            {t("loadError")}
          </p>
        )}
        {loaded.status === "loading" ? (
          <div role="status" aria-label={t("loading")} className="grid grid-cols-2 gap-space-2-5 md:grid-cols-4">
            {[0, 1, 2, 3].map((n) => (
              <span key={n} className="h-space-8 rounded-card bg-surface-raised motion-safe:animate-pulse" />
            ))}
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-space-2-5 md:grid-cols-4 md:gap-space-3">
            <Tile
              testId="tile-dressing"
              label={t("glance.dressing.label")}
              big={loaded.status === "ready" ? String(loaded.glance.counts.dressing) : "–"}
              line={t("glance.dressing.line", {
                count: loaded.status === "ready" ? loaded.glance.counts.dressing : 0,
              })}
              href={stepHref("dressing")}
            />
            <Tile
              testId="tile-a-vendre"
              label={t("glance.forSale.label")}
              big={loaded.status === "ready" ? String(loaded.glance.counts.aVendre) : "–"}
              line={t("glance.forSale.line", {
                count: loaded.status === "ready" ? loaded.glance.counts.aVendre : 0,
              })}
              href={stepHref("a-vendre")}
            />
            <Tile
              testId="tile-commandes"
              label={t("glance.orders.label")}
              big={t("glance.orders.soon")}
              line={t("glance.orders.line")}
            />
            <BudgetTile budget={loaded.status === "ready" ? loaded.glance.budget : null} href={stepHref("envie")} />
          </ul>
        )}
      </section>

      <div className="flex flex-col gap-space-1-5 rounded-card bg-surface-sunken p-space-3-5">
        <span className={kickerClass}>{t("returns.kicker")}</span>
        <b className="text-sm">{t("returns.title")}</b>
        <span className="text-chip text-ink-muted">{t("returns.text")}</span>
      </div>

      {loaded.status === "ready" && <Dressing items={loaded.glance.dressing} allHref={stepHref("dressing")} />}

      <section className="flex flex-col gap-space-2-5">
        <h2 className={sectionTitleClass}>{t("placesTitle")}</h2>
        <MePlaces />
      </section>
    </div>
  );
}
