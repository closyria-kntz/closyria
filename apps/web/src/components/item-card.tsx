"use client";

import type { ItemView } from "@closyria/shared";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { formatOptionalPrice } from "@/lib/price";
import { focusRing } from "./ui";

type Props = {
  item: ItemView;
  selected: boolean;
  /** At least one card is selected: a click on a card then selects instead of opening. */
  selecting: boolean;
  onToggle: (id: string) => void;
  /** Show the stage (« Vendu », « Renvoyé »): for the items that the view's own stage does not describe. */
  showStage: boolean;
};

/** One item in the grid: 3:4 frame with the whole photo, name, shop, price, favourite, link to the sheet. */
export function ItemCard({ item, selected, selecting, onToggle, showStage }: Props) {
  const t = useTranslations("Views.card");
  const tStage = useTranslations("Item.stage");
  const locale = useLocale();
  const name = item.name?.trim() || t("noName");
  const asked = item.stage === "for_sale" || item.stage === "sold" ? item.salePriceCents : null;
  const price = formatOptionalPrice(
    locale,
    asked ?? item.product.priceCents,
    item.product.currency ?? "EUR",
    t("noPrice"),
  );
  return (
    <li className="card group relative flex flex-col" data-testid="item-card">
      <Link
        href={`/produits/${item.product.id}`}
        onClick={(event) => {
          if (!selecting) return;
          event.preventDefault();
          onToggle(item.id);
        }}
        className={`flex flex-col gap-space-2 rounded-card ${focusRing}`}
      >
        <div
          className={`relative aspect-3/4 overflow-hidden rounded-card bg-media-backdrop ${selected ? "outline-2 outline-accent outline-solid" : ""}`}
        >
          {item.coverUrl ? (
            // biome-ignore lint/performance/noImgElement: photos come from our own API, already resized.
            <img
              src={item.coverUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="card-photo size-full object-contain"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-full items-center justify-center p-space-3 text-center text-sm text-ink-muted"
            >
              {t("noPhoto")}
            </span>
          )}
          {item.favorite && (
            <span
              role="img"
              aria-label={t("favorite")}
              className="absolute right-space-2 bottom-space-2 flex size-space-6 items-center justify-center rounded-full bg-surface-raised text-accent shadow-soft"
            >
              <span aria-hidden="true">♥</span>
            </span>
          )}
          {showStage && (item.stage === "sold" || item.stage === "returned") && (
            <span className="absolute top-space-2 right-space-2 rounded-full bg-ink px-space-2 py-space-1 text-sm text-surface-raised">
              {tStage(item.stage)}
            </span>
          )}
        </div>
        <div className="flex min-w-space-0 flex-col px-space-1">
          <span className="truncate text-sm font-strong">{name}</span>
          <span className="truncate text-sm text-ink-muted">{item.product.shop.name}</span>
          <span className="text-sm">{price}</span>
        </div>
      </Link>
      <label className="absolute top-space-1 left-space-1 flex size-touch-target cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(item.id)}
          aria-label={t("select", { name })}
          className={`size-space-5 accent-accent ${focusRing}`}
        />
      </label>
    </li>
  );
}
