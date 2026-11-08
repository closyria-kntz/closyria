"use client";

import type { ItemView } from "@closyria/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { formatOptionalPrice } from "@/lib/price";
import { ItemMenu } from "./item-menu";
import { PHOTO_CLICK_DELAY_MS, photoClickPlan } from "./level-picker-logic";
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

/** « Sélectionner » mode: the whole card toggles the item in the selection. */
export type CardSelection = { selected: boolean; onToggle: (id: string) => void };

type Props = {
  item: ItemView;
  /** In « Sélectionner » mode: a tap toggles the card, the pill and « … » step aside (only the level shows). */
  selection?: CardSelection | undefined;
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
export function ItemCard({ item, actions, selection, showStage, linked = true, children }: Props) {
  const t = useTranslations("Views.card");
  const tStage = useTranslations("Item.stage");
  const locale = useLocale();
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(openTimer.current), []);
  const href = `/produits/${item.product.id}`;
  // A click on the photo waits a beat: a second click (double tap) opens the 4 levels instead of the sheet.
  // The keyboard, a middle click and cmd / ctrl / shift clicks keep the link's own behaviour.
  const onPhotoClick =
    actions && !selection && linked
      ? (event: MouseEvent<HTMLAnchorElement>) => {
          if (!(event.target as Element).closest("[data-photo]")) return;
          const plan = photoClickPlan(event.nativeEvent);
          if (plan === "pass") return;
          event.preventDefault();
          clearTimeout(openTimer.current);
          if (plan === "pick") setPickerOpen(true);
          else if (plan === "wait") openTimer.current = setTimeout(() => router.push(href), PHOTO_CLICK_DELAY_MS);
        }
      : undefined;
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
        href={href}
        onClick={onPhotoClick}
        selection={selection}
        onToggle={() => selection?.onToggle(item.id)}
      >
        <div data-photo className="relative aspect-3/4 overflow-hidden rounded-card bg-media-backdrop">
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
            <span className="absolute bottom-space-2 left-space-2 rounded-full bg-accent px-space-2 py-space-1 text-caption font-strong text-accent-ink">
              {t("priority")}
            </span>
          )}
          {selection && (
            <span
              aria-hidden="true"
              className={`absolute top-space-2 right-space-2 flex size-space-6 items-center justify-center rounded-full border-2 ${
                selection.selected ? "border-accent bg-accent text-accent-ink" : "border-surface-raised bg-ink/20"
              }`}
            >
              {selection.selected && (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  className="size-space-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
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
      {actions && !selection ? (
        <>
          <LoveLevelPill
            item={item}
            onChange={actions.onChanged}
            reload={actions.reload}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
          />
          <ItemMenu item={item} onChanged={actions.onChanged} onTrashed={actions.onTrashed} reload={actions.reload} />
        </>
      ) : (
        <LoveLevelBadge item={item} />
      )}
      {children}
    </li>
  );
}

function Wrapper({
  linked,
  href,
  onClick,
  selection,
  onToggle,
  children,
}: {
  linked: boolean;
  href: string;
  onClick: ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined;
  selection: CardSelection | undefined;
  onToggle: () => void;
  children: ReactNode;
}) {
  if (selection) {
    return (
      <button
        type="button"
        aria-pressed={selection.selected}
        onClick={onToggle}
        className={`flex flex-col gap-space-2 rounded-card text-left ${focusRing} ${selection.selected ? "ring-2 ring-accent" : ""}`}
      >
        {children}
      </button>
    );
  }
  if (!linked) return <div className="flex flex-col gap-space-2">{children}</div>;
  return (
    <Link
      href={href}
      {...(onClick ? { onClick } : {})}
      className={`flex flex-col gap-space-2 rounded-card ${focusRing}`}
    >
      {children}
    </Link>
  );
}
