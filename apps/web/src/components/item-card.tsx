"use client";

import type { ItemView } from "@closyria/shared";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { MouseEvent, ReactNode } from "react";
import { formatOptionalPrice } from "@/lib/price";
import { focusRing } from "./ui";

type Props = {
  item: ItemView;
  selected: boolean;
  /** At least one card is selected: a click on a card then selects instead of opening. */
  selecting: boolean;
  /** Without it the card has no selection box (list contents, trash). */
  onToggle?: ((id: string) => void) | undefined;
  /** False: no link to the sheet (the trash). */
  linked?: boolean;
  /** Extra controls under the card (move up / down, remove, restore…). */
  children?: ReactNode;
  /** Show the stage (« Vendu », « Renvoyé »): for the items that the view's own stage does not describe. */
  showStage: boolean;
};

/** One item in the grid: 3:4 frame with the whole photo, name, shop, price, favourite, link to the sheet. */
export function ItemCard({ item, selected, selecting, onToggle, showStage, linked = true, children }: Props) {
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
      <Wrapper
        linked={linked}
        href={`/produits/${item.product.id}`}
        onClick={(event) => {
          if (!selecting || !onToggle) return;
          event.preventDefault();
          onToggle(item.id);
        }}
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
      </Wrapper>
      {onToggle && (
        <label className="absolute top-space-1 left-space-1 flex size-touch-target cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(item.id)}
            aria-label={t("select", { name })}
            className={`size-space-5 accent-accent ${focusRing}`}
          />
        </label>
      )}
      {children}
    </li>
  );
}

function Wrapper({
  linked,
  href,
  onClick,
  children,
}: {
  linked: boolean;
  href: string;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
  children: ReactNode;
}) {
  if (!linked) return <div className="flex flex-col gap-space-2">{children}</div>;
  return (
    <Link href={href} onClick={onClick} className={`flex flex-col gap-space-2 rounded-card ${focusRing}`}>
      {children}
    </Link>
  );
}
