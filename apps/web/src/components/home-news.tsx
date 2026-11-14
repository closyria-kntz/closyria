"use client";

import type { HomeNews, HomeNewsKind } from "@closyria/shared";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useId, useState } from "react";
import { saleDayWords } from "@/lib/alert-words";
import { formatPrice } from "@/lib/price";
import { relativeDate } from "@/lib/relative-date";
import { focusRing } from "./ui";

/** « Ce qui a changé » shows this many; « Tout voir » the rest. */
const SHOWN = 3;

/** The round icon of a news without a photo (mockup .nw .ico). */
export const NEWS_ICONS: Record<HomeNewsKind, string> = {
  price_drop: "🏷️",
  size_back: "📏",
  target_price: "🎯",
  opinion: "💬",
  group_order: "🛍️",
  gift_reminder: "🎁",
  sale_period: "🗓️",
  shop_promo: "🏬",
};

/** The title of a section of « Accueil » (mockup .t3) and the link or button on its right (mockup .more). */
export const sectionTitleClass = "font-title text-section-title leading-tight font-regular";
export const moreClass = `inline-flex min-h-touch-target items-center text-chip font-bold underline underline-offset-3 ${focusRing}`;

/**
 * « Les soldes commencent aujourd'hui / demain / mercredi / le 7 janvier » (« ont commencé hier… » once they have),
 * counted from today in Paris; `strong` wraps the sentence.
 */
export function useSaleSentence() {
  const t = useTranslations("Home.news");
  const locale = useLocale();
  return (startsOn: string | null, strong: (chunks: ReactNode) => ReactNode): ReactNode => {
    if (!startsOn) return null;
    const words = saleDayWords(startsOn, new Date(), locale);
    const day = words.kind === "date" ? t("saleDate", { date: words.text }) : words.text;
    return t.rich(words.started ? "sale_periodStarted" : "sale_period", { day, b: strong });
  };
}

/** A news in words: its sentence (with `strong` around the name) and its second line. */
export function useNewsWords() {
  const t = useTranslations("Home.news");
  const locale = useLocale();
  const saleSentence = useSaleSentence();
  const price = (cents: number | null, currency: string | null) =>
    cents === null ? "" : formatPrice(locale, cents, currency ?? "EUR");
  return (news: HomeNews, strong: (chunks: ReactNode) => ReactNode): { line: ReactNode; detail: string } => {
    const name = news.title;
    switch (news.kind) {
      case "price_drop":
        return {
          line: t.rich("price_drop", { name, price: price(news.priceCents, news.currency), b: strong }),
          detail: t("priceDropDetail", {
            drop: price((news.previousPriceCents ?? 0) - (news.priceCents ?? 0), news.currency),
            shop: news.detail ?? "",
          }),
        };
      case "size_back":
        return {
          line: t.rich("size_back", { name, size: news.sizeLabel ?? "", b: strong }),
          detail: t("sizeBackDetail", { shop: news.detail ?? "" }),
        };
      case "opinion":
        return {
          line: t.rich("opinion", {
            author: news.authorName ?? "",
            others: Math.max(0, (news.count ?? 1) - 1),
            name,
            b: strong,
          }),
          detail: news.detail ? t("opinionNote", { note: news.detail }) : "",
        };
      case "group_order":
        return {
          line: t.rich("group_order", { shop: news.detail ?? "", b: strong }),
          detail: t(news.groupOrderStatus === "closed" ? "groupOrderClosed" : "groupOrderOpen", { list: name }),
        };
      case "gift_reminder":
        return {
          line: t.rich("gift_reminder", { list: name, b: strong }),
          detail: news.detail ? t("giftOccasion", { occasion: news.detail }) : t("giftDate"),
        };
      case "target_price":
        return {
          line: t.rich(news.targetPriceCents === null ? "price_drop" : "target_price", {
            name,
            price: price(news.priceCents, news.currency),
            target: price(news.targetPriceCents, news.currency),
            b: strong,
          }),
          detail: news.detail ? t("targetPriceDetail", { shop: news.detail }) : "",
        };
      case "sale_period":
        return { line: saleSentence(news.startsOn, strong), detail: name };
      case "shop_promo":
        return { line: t.rich("shop_promo", { shop: name, b: strong }), detail: "" };
    }
  };
}

function NewsRow({ news, now }: { news: HomeNews; now: Date }) {
  const t = useTranslations("Home.news");
  const locale = useLocale();
  const words = useNewsWords();
  const { line, detail } = words(news, (chunks) => <b>{chunks}</b>);
  const when = relativeDate(news.at, now, locale);
  return (
    <li>
      <Link
        href={news.href}
        className={`flex min-h-touch-target items-center gap-space-3 rounded-card bg-surface-raised p-space-2-5 hover:bg-surface-sunken ${focusRing}`}
      >
        {news.photoUrl ? (
          // biome-ignore lint/performance/noImgElement: photos come from our own API, already resized.
          <img
            src={news.photoUrl}
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
            {NEWS_ICONS[news.kind]}
          </span>
        )}
        <span className="flex min-w-space-0 flex-1 flex-col gap-space-0-5">
          <span className="text-sm">{line}</span>
          <span className="text-meta text-ink-muted">{detail ? `${detail} · ${when}` : when}</span>
        </span>
        <span className="shrink-0 text-chip font-bold underline underline-offset-3">{t(`action.${news.kind}`)}</span>
      </Link>
    </li>
  );
}

/** « Ce qui a changé » (mockup .news): the first three news, « Tout voir » shows the others. */
export function HomeNewsList({ news, now }: { news: readonly HomeNews[]; now: Date }) {
  const t = useTranslations("Home.news");
  const titleId = useId();
  const listId = useId();
  const [all, setAll] = useState(false);
  if (news.length === 0) return null;
  const shown = all ? news : news.slice(0, SHOWN);
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-space-2-5">
      <div className="flex items-baseline justify-between gap-space-2-5">
        <h2 id={titleId} className={sectionTitleClass}>
          {t("title")}
        </h2>
        {news.length > SHOWN && (
          <button
            type="button"
            aria-expanded={all}
            aria-controls={listId}
            onClick={() => setAll(!all)}
            className={moreClass}
          >
            {all ? t("fewer") : t("all")}
          </button>
        )}
      </div>
      <ul id={listId} className="flex flex-col gap-space-2-5">
        {shown.map((item) => (
          <NewsRow key={`${item.kind}:${item.href}:${item.itemId ?? ""}`} news={item} now={now} />
        ))}
      </ul>
      <Link href="/nouvelles" className={`${moreClass} self-start`}>
        {t("allNews")}
      </Link>
    </section>
  );
}
