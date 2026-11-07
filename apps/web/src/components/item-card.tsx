"use client";

import type { ItemView } from "@closyria/shared";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { formatOptionalPrice } from "@/lib/price";
import { ItemMenu } from "./item-menu";
import { LoveLevelBadge, LoveLevelPill } from "./love-level-pill";
import { focusRing } from "./ui";

export type CardActions = {
  /** The item came back changed from the API (pill or « … » menu). */
  onChanged: (item: ItemView) => void;
  /** The item went to the trash from the « … » menu. */
  onTrashed: (id: string) => void;
  /** Re-reads what changed (after « Annuler »). */
  reload: () => Promise<void>;
};

type Props = {
  item: ItemView;
  /** The level pill and the « … » menu; without them the level only shows (the trash). */
  actions?: CardActions | undefined;
  /** False: no link to the sheet (the trash). */
  linked?: boolean;
  /** Extra controls under the card (move up / down, remove, restore…). */
  children?: ReactNode;
  /** Show the stage (« Vendu », « Renvoyé »): for the items that the view's own stage does not describe. */
  showStage: boolean;
};

/**
 * One item in the grid (spec §3.2): 3:4 frame with the whole photo, level pill top left, « … » top right,
 * « Prioritaire » at the bottom of the photo; name, shop, price and her opinion under it; link to the sheet.
 */
export function ItemCard({ item, actions, showStage, linked = true, children }: Props) {
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
      <Wrapper linked={linked} href={`/produits/${item.product.id}`}>
        <div className="relative aspect-3/4 overflow-hidden rounded-card bg-media-backdrop">
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
          {item.priority && (
            <span className="absolute bottom-space-2 left-space-2 rounded-full bg-accent px-space-2 py-space-1 text-caption font-strong text-accent-ink shadow-soft">
              {t("priority")}
            </span>
          )}
          {showStage && (item.stage === "sold" || item.stage === "returned") && (
            <span className="absolute right-space-2 bottom-space-2 rounded-full bg-ink px-space-2 py-space-1 text-sm text-surface-raised">
              {tStage(item.stage)}
            </span>
          )}
        </div>
        <div className="flex min-w-space-0 flex-col px-space-1">
          <span className="truncate text-sm font-strong">{name}</span>
          <span className="truncate text-sm text-ink-muted">{item.product.shop.name}</span>
          <span className="text-sm">{price}</span>
          {item.why && <span className="truncate text-sm text-ink-muted italic">{t("why", { why: item.why })}</span>}
        </div>
      </Wrapper>
      {actions ? (
        <>
          <LoveLevelPill item={item} onChange={actions.onChanged} reload={actions.reload} />
          <ItemMenu item={item} onChanged={actions.onChanged} onTrashed={actions.onTrashed} reload={actions.reload} />
        </>
      ) : (
        <LoveLevelBadge item={item} />
      )}
      {children}
    </li>
  );
}

function Wrapper({ linked, href, children }: { linked: boolean; href: string; children: ReactNode }) {
  if (!linked) return <div className="flex flex-col gap-space-2">{children}</div>;
  return (
    <Link href={href} className={`flex flex-col gap-space-2 rounded-card ${focusRing}`}>
      {children}
    </Link>
  );
}
