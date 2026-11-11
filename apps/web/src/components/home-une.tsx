"use client";

import type { HomeNews } from "@closyria/shared";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useId } from "react";
import { formatPrice } from "@/lib/price";
import { useNewsWords } from "./home-news";
import { primaryButtonClass } from "./ui";

/** The kinds a une can be: those that come with an item's photo. */
type UneKind = "price_drop" | "size_back" | "opinion";
const isUneKind = (kind: HomeNews["kind"]): kind is UneKind =>
  kind === "price_drop" || kind === "size_back" || kind === "opinion";

/**
 * The « une » of « Accueil » (mockup .une): the newest news with a photo, the photo on the left (42 %), on the right a
 * powder-pink panel with its kind, its sentence in Gloock, its detail and a written button.
 */
export function HomeUne({ news }: { news: HomeNews }) {
  const t = useTranslations("Home");
  const locale = useLocale();
  const titleId = useId();
  const words = useNewsWords();
  if (!isUneKind(news.kind) || !news.photoUrl) return null;
  const kind = news.kind;
  const { detail } = words(news, (chunks) => chunks);
  const sentence =
    kind === "price_drop"
      ? t("une.price_drop", {
          name: news.title,
          price: news.priceCents === null ? "" : formatPrice(locale, news.priceCents, news.currency ?? "EUR"),
        })
      : kind === "size_back"
        ? t("une.size_back", { name: news.title, size: news.sizeLabel ?? "" })
        : t("une.opinion", {
            author: news.authorName ?? "",
            others: Math.max(0, (news.count ?? 1) - 1),
            name: news.title,
          });
  return (
    <article
      aria-labelledby={titleId}
      className="grid grid-cols-(--grid-une) overflow-hidden rounded-card bg-une text-ink"
    >
      {/* biome-ignore lint/performance/noImgElement: photos come from our own API, already resized. */}
      <img src={news.photoUrl} alt="" decoding="async" className="aspect-3/4 size-full object-cover" />
      <div className="flex min-w-space-0 flex-col justify-center gap-space-1-5 p-space-3-5">
        <span className="text-meta font-bold tracking-wide text-une-ink uppercase">{t(`kind.${kind}`)}</span>
        <h2 id={titleId} className="font-title text-une-title leading-tight font-regular">
          {sentence}
        </h2>
        {detail && <p className="text-chip">{detail}</p>}
        <Link href={news.href} className={`${primaryButtonClass} mt-space-1 min-h-touch-target self-start`}>
          {t(`une.open.${kind}`)}
        </Link>
      </div>
    </article>
  );
}
