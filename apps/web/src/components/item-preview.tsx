"use client";

import type { ItemView, LoveLevelView } from "@closyria/shared";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { levelOf } from "@/lib/love-levels";
import { priceDropCents } from "@/lib/price";
import { ItemOpinionsSection } from "./item-opinions-section";
import { Sheet } from "./sheet";
import { SquareCheck } from "./square-check";
import { focusRing } from "./ui";

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

type Props = {
  /** The item shown; null: the preview is closed. */
  item: ItemView | null;
  levels: readonly LoveLevelView[];
  money: (cents: number) => string;
  onClose: () => void;
  onToggle: (item: ItemView) => void;
};

/**
 * Quick look at a wish over « Préparer une commande », without leaving the page: a sheet from the bottom on a phone,
 * a large panel on the right on a computer. Closes with « Fermer », Escape, a click beside it, the back button (the
 * caller keeps it in the address) or a drag down from its top.
 */
export function ItemPreview({ item, levels, money, onClose, onToggle }: Props) {
  const t = useTranslations("OrderDraft.preview");
  const tRow = useTranslations("OrderDraft.row");
  const titleId = useId();
  const checkId = useId();

  const name = item ? item.name?.trim() || tRow("noName") : "";
  const level = item?.loveLevel != null ? levelOf(levels, item.loveLevel) : null;
  const photos = item
    ? item.photos.length > 0
      ? item.photos.map((photo) => photo.url)
      : item.coverUrl
        ? [item.coverUrl]
        : []
    : [];
  const price = item?.product.priceCents ?? null;
  const drop = item ? priceDropCents(price, item.product.compareAtCents) : null;
  const size = item ? [item.sizeLabel, item.sizeNote && `« ${item.sizeNote} »`].filter(Boolean).join(" · ") : "";

  return (
    <Sheet
      open={item !== null}
      onClose={onClose}
      labelledBy={titleId}
      closeLabel={t("close")}
      hint={t("closeHint")}
      wide
      bodyClassName={photos.length > 0 ? "md:grid-cols-2" : ""}
      footer={
        item && (
          <div className="flex flex-col gap-space-2 border-t border-line p-space-4 md:flex-row md:items-center">
            <label
              htmlFor={checkId}
              className="flex min-h-touch-target flex-1 cursor-pointer items-center gap-space-3 rounded-card border-2 border-line px-space-3 font-strong has-checked:border-selected-line has-checked:bg-selected-surface has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring has-focus-visible:outline-solid"
            >
              <span className="relative flex size-space-5 shrink-0">
                <SquareCheck id={checkId} checked={item.inOrderDraft} onChange={() => onToggle(item)} />
              </span>
              {t("take")}
              <span className="ml-auto text-sm text-ink-muted">{t("takeHint")}</span>
            </label>
            {isHttpUrl(item.product.canonicalUrl) && (
              <a
                href={item.product.canonicalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex min-h-touch-target items-center justify-center gap-space-2 rounded-button bg-band-button px-space-4 text-sm font-strong text-band-button-ink hover:bg-band-button-hover ${focusRing}`}
              >
                {tRow("viewAt", { shop: item.product.shop.name })}
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  className="size-space-3 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M5 11l6-6M6 5h5v5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            )}
          </div>
        )
      }
    >
      {item && (
        <>
          {photos.length > 0 && (
            <section
              aria-label={t("photos")}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable strip must be reachable by keyboard.
              tabIndex={0}
              className={`flex snap-x snap-mandatory gap-space-2 overflow-x-auto rounded-card ${focusRing}`}
            >
              {photos.map((url) => (
                // biome-ignore lint/performance/noImgElement: photos come from our own API, already resized.
                <img
                  key={url}
                  src={url}
                  alt=""
                  decoding="async"
                  className={`arch aspect-3/4 shrink-0 snap-start bg-media-backdrop object-cover ${photos.length > 1 ? "w-4/5" : "w-full"}`}
                />
              ))}
            </section>
          )}
          <div className="flex flex-col gap-space-3">
            <div className="flex flex-col gap-space-1">
              {item.brand && <p className="text-sm text-ink-muted uppercase">{item.brand}</p>}
              <h2 id={titleId} className="font-display text-lead font-strong text-balance">
                <span className="sr-only">{t("titlePrefix")} </span>
                {name}
              </h2>
              <p className="flex flex-wrap items-baseline gap-space-2 font-strong tabular-nums">
                {price === null ? tRow("unknownPrice") : money(price)}
                {drop !== null && item?.product.compareAtCents != null && (
                  <>
                    <s className="font-normal text-ink-muted">{money(item.product.compareAtCents)}</s>
                    <span className="rounded-full bg-success-soft px-space-2 text-sm text-success">−{money(drop)}</span>
                  </>
                )}
              </p>
            </div>
            {(level || item.priority) && (
              <ul className="flex flex-wrap gap-space-2 text-sm">
                {level && (
                  <li className="rounded-button border border-line px-space-2">
                    {level.emoji} {level.label}
                  </li>
                )}
                {item.priority && <li className="rounded-button border border-line px-space-2">{tRow("priority")}</li>}
              </ul>
            )}
            {(size || item.why || item.notes) && (
              <dl className="flex flex-col gap-space-1 text-sm">
                {(
                  [
                    ["size", size],
                    ["why", item.why],
                    ["notes", item.notes],
                  ] as const
                ).map(([key, value]) =>
                  value ? (
                    <div key={key} className="flex gap-space-3">
                      <dt className="shrink-0 text-ink-muted">{t(key)}</dt>
                      <dd className="whitespace-pre-line">{value}</dd>
                    </div>
                  ) : null,
                )}
              </dl>
            )}
            <ItemOpinionsSection itemId={item.id} />
            <Link
              href={`/produits/${item.product.id}`}
              className={`self-start rounded-sm text-sm text-ink-muted underline underline-offset-2 hover:text-ink ${focusRing}`}
            >
              {t("full")}
            </Link>
          </div>
        </>
      )}
    </Sheet>
  );
}
