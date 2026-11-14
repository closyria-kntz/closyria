"use client";

import { type AlertEventView, parisDay } from "@closyria/shared";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useState } from "react";
import { daysUntil } from "@/lib/alert-words";
import { formatPrice } from "@/lib/price";
import { fetchAlerts, markAlertsRead } from "@/lib/push";
import { relativeDate } from "@/lib/relative-date";
import { moreClass, NEWS_ICONS, sectionTitleClass, useSaleSentence } from "./home-news";
import { buttonClass, focusRing, primaryButtonClass } from "./ui";

/** One alert in words: its sentence and its second line (the facts only; the page says them). */
function useAlertWords() {
  const t = useTranslations("News");
  const tHome = useTranslations("Home.news");
  const locale = useLocale();
  const saleSentence = useSaleSentence();
  const price = (cents: number | null, currency: string | null) =>
    cents === null ? "" : formatPrice(locale, cents, currency ?? "EUR");
  return (alert: AlertEventView): { line: ReactNode; detail: string } => {
    const name = alert.title.trim() || t("unnamed");
    const shop = alert.shopName;
    switch (alert.kind) {
      case "size_back": {
        const size = alert.sizeLabel;
        const key = size ? (shop ? "size_back" : "size_backNoShop") : shop ? "size_backNoSize" : "size_backNothing";
        return { line: t(key, { name, size: size ?? "", shop: shop ?? "" }), detail: "" };
      }
      case "target_price":
        return {
          line:
            alert.targetPriceCents === null
              ? t("target_priceNoTarget", { name, price: price(alert.priceCents, alert.currency) })
              : t("target_price", {
                  name,
                  price: price(alert.priceCents, alert.currency),
                  target: price(alert.targetPriceCents, alert.currency),
                }),
          detail: shop ?? "",
        };
      case "price_drop": {
        const drop = price(Math.max(0, (alert.previousCents ?? 0) - (alert.priceCents ?? 0)), alert.currency);
        return {
          line: t("price_drop", { name, price: price(alert.priceCents, alert.currency) }),
          detail:
            alert.previousCents === null
              ? (shop ?? "")
              : shop
                ? t("priceDropDetail", { drop, shop })
                : t("priceDropNoShop", { drop }),
        };
      }
      case "sale_period":
        return { line: saleSentence(alert.startsOn, (chunks) => chunks), detail: alert.salePeriodName ?? "" };
      case "shop_promo":
        return { line: tHome.rich("shop_promo", { shop: name, b: (chunks) => chunks }), detail: "" };
    }
  };
}

function AlertRow({ alert, unread, now }: { alert: AlertEventView; unread: boolean; now: Date }) {
  const t = useTranslations("News");
  const tKind = useTranslations("Home.kind");
  const locale = useLocale();
  const words = useAlertWords();
  const { line, detail } = words(alert);
  const when = relativeDate(alert.createdAt, now, locale);
  return (
    <li>
      <Link
        href={alert.href}
        className={`flex min-h-touch-target items-center gap-space-3 rounded-card bg-surface-raised p-space-2-5 hover:bg-surface-sunken ${focusRing}`}
      >
        {alert.photoUrl ? (
          // biome-ignore lint/performance/noImgElement: photos come from our own API, already resized.
          <img
            src={alert.photoUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="aspect-3/4 w-touch-target shrink-0 rounded-board-row object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="grid size-touch-target shrink-0 place-items-center rounded-full bg-hint text-heading"
          >
            {NEWS_ICONS[alert.kind]}
          </span>
        )}
        <span className="flex min-w-space-0 flex-1 flex-col gap-space-0-5">
          <span className="flex flex-wrap items-center gap-space-2 text-meta font-bold tracking-wide text-accent uppercase">
            {tKind(alert.kind)}
            {unread && (
              <span className="rounded-pill bg-une px-space-2 text-meta font-bold tracking-normal text-ink normal-case">
                {t("unread")}
              </span>
            )}
          </span>
          <span className="text-sm font-strong">{line}</span>
          <span className="text-meta text-ink-muted">{detail ? `${detail} · ${when}` : when}</span>
        </span>
        <span className="shrink-0 text-chip font-bold underline underline-offset-3">{t("action")}</span>
      </Link>
    </li>
  );
}

/** Her alerts grouped by Paris day, newest first. */
function byDay(alerts: readonly AlertEventView[]): [string, AlertEventView[]][] {
  const days = new Map<string, AlertEventView[]>();
  for (const alert of alerts) {
    const day = parisDay(new Date(alert.createdAt));
    days.set(day, [...(days.get(day) ?? []), alert]);
  }
  return [...days.entries()];
}

function DayGroup({
  day,
  alerts,
  unread,
  now,
}: {
  day: string;
  alerts: AlertEventView[];
  unread: Set<string>;
  now: Date;
}) {
  const t = useTranslations("News");
  const locale = useLocale();
  const titleId = useId();
  const offset = daysUntil(day, now);
  const title =
    offset === 0
      ? t("today")
      : offset === -1
        ? t("yesterday")
        : new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
            new Date(`${day}T12:00:00Z`),
          );
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-space-2-5">
      <h2 id={titleId} className={`${sectionTitleClass} first-letter:uppercase`}>
        {title}
      </h2>
      <ul className="flex flex-col gap-space-2-5">
        {alerts.map((alert) => (
          <AlertRow key={alert.id} alert={alert} unread={unread.has(alert.id)} now={now} />
        ))}
      </ul>
    </section>
  );
}

/**
 * « Nouvelles » (chantier 4, spec §3.2): her alerts of the last 30 days, newest first, by day; each opens its item's
 * sheet (or stays here for the sales and promos). The ones she had not seen say « Nouveau » this time, then count as
 * read.
 */
export function NewsScreen() {
  const t = useTranslations("News");
  const [alerts, setAlerts] = useState<AlertEventView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed" | "more">("loading");
  const [unread, setUnread] = useState<Set<string>>(new Set());
  const [attempt, setAttempt] = useState(0);
  const [now] = useState(() => new Date());

  const load = async (from: string | null) => {
    const page = await fetchAlerts(from);
    const fresh = page.alerts.filter((a) => a.readAt === null).map((a) => a.id);
    setAlerts((current) => (from ? [...current, ...page.alerts] : page.alerts));
    setCursor(page.nextCursor);
    setUnread((current) => new Set([...current, ...fresh]));
    void markAlertsRead(fresh);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: the first page, once and on « Réessayer ».
  useEffect(() => {
    let alive = true;
    setState("loading");
    load(null).then(
      () => alive && setState("ready"),
      () => alive && setState("failed"),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  const more = () => {
    setState("more");
    load(cursor).then(
      () => setState("ready"),
      () => setState("failed"),
    );
  };

  return (
    <div className="flex max-w-measure flex-col gap-space-5 pb-space-6">
      <div className="flex flex-col gap-space-2">
        <h1 className="font-title text-page-title leading-none font-regular">{t("title")}</h1>
        <p className="text-ink-muted">{t("intro")}</p>
      </div>

      {state === "loading" ? (
        <p role="status">{t("loading")}</p>
      ) : state === "failed" && alerts.length === 0 ? (
        <div className="flex flex-col items-start gap-space-2">
          <p role="alert" className="text-danger">
            {t("failed")}
          </p>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className={`${buttonClass} min-h-touch-target`}
          >
            {t("retry")}
          </button>
        </div>
      ) : alerts.length === 0 ? (
        <section
          aria-labelledby="news-empty"
          className="flex flex-col gap-space-3 rounded-card bg-surface-sunken p-space-5"
        >
          <h2 id="news-empty" className={sectionTitleClass}>
            {t("emptyTitle")}
          </h2>
          <p>{t("emptyBody")}</p>
          <Link href="/reglages/notifications" className={`${primaryButtonClass} min-h-touch-target self-start`}>
            {t("settings")}
          </Link>
        </section>
      ) : (
        <>
          {byDay(alerts).map(([day, list]) => (
            <DayGroup key={day} day={day} alerts={list} unread={unread} now={now} />
          ))}
          {state === "failed" && (
            <p role="alert" className="text-sm text-danger">
              {t("failed")}
            </p>
          )}
          {cursor && (
            <button
              type="button"
              disabled={state === "more"}
              onClick={more}
              className={`${buttonClass} min-h-touch-target self-start`}
            >
              {t("more")}
            </button>
          )}
          <Link href="/reglages/notifications" className={`${moreClass} self-start`}>
            {t("settings")}
          </Link>
        </>
      )}
    </div>
  );
}
