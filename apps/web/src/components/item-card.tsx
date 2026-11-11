"use client";

import type { ItemView } from "@closyria/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { formatAmount } from "@/lib/budget";
import { formatOptionalPrice, priceDropCents } from "@/lib/price";
import { itemStep } from "@/lib/wardrobe-view";
import { ItemMenu } from "./item-menu";
import { PHOTO_CLICK_DELAY_MS, photoClickPlan } from "./level-picker-logic";
import { LoveLevelBadge, LoveLevelPill } from "./love-level-pill";
import { Tick } from "./tick";
import { focusRing } from "./ui";

export type CardActions = {
  /** The item came back changed from the API (pill or « … » menu). */
  onChanged: (item: ItemView) => void;
  /** The item went to the trash from the « … » menu. */
  onTrashed: (id: string) => void;
  /** Re-reads what changed (after « Annuler »). */
  reload: () => Promise<void>;
  /** « Je le prends » / « Retirer » on the card (« Mes envies » only; without it the button does not show);
   * `photo` is the card's photo, where the flight to « Ma commande » starts. */
  onTake?: (item: ItemView, photo?: Element | null) => void;
  /** « Aperçu » on the card (« Mes envies » only). */
  onPreview?: (item: ItemView) => void;
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
  /** The name of its type (« Robe »), shown before the shop when known. */
  typeName?: string | null | undefined;
};

/**
 * One item in the grid (refonte Boudoir, mockup .card): a white card with 20 px corners, its 3:4 photo on top with
 * its step as an ochre clothing tag top left (the « taken » tick under it) and her level emoji top right (the
 * mockup's heart); then the name (Gloock), « type · boutique », « Prioritaire », her opinion, and the price in a
 * powder-pink price tag (crossed price and « −20 € » inside it) with « … » beside it, bottom right.
 */
export function ItemCard({ item, actions, selection, typeName, linked = true, children }: Props) {
  const t = useTranslations("Views.card");
  const tStep = useTranslations("Views.step");
  const tStage = useTranslations("Item.stage");
  const locale = useLocale();
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(openTimer.current), []);
  // The emoji picker opened within the beat after a photo click: that click no longer opens the sheet.
  const changePicker = (open: boolean) => {
    if (open) clearTimeout(openTimer.current);
    setPickerOpen(open);
  };
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
  const currency = item.product.currency ?? "EUR";
  const price = formatOptionalPrice(locale, asked ?? item.product.priceCents, currency, t("noPrice"));
  // The shop's crossed price, only while the card shows the shop's price (not the price she asks).
  const drop = asked === null ? priceDropCents(item.product.priceCents, item.product.compareAtCents) : null;
  const quick = actions && !selection && actions.onTake && actions.onPreview ? actions : null;
  const step = itemStep(item);
  const stepLabel = step ? tStep(step) : tStage(item.stage);
  const shop = item.product.shop.name;
  return (
    <li className="card card-rise group relative flex flex-col rounded-card bg-surface-raised" data-testid="item-card">
      <Wrapper
        linked={linked}
        href={href}
        onClick={onPhotoClick}
        selection={selection}
        onToggle={() => selection?.onToggle(item.id)}
      >
        <div data-photo className="relative aspect-3/4 overflow-hidden rounded-t-card bg-media-backdrop">
          {item.coverUrl ? (
            // biome-ignore lint/performance/noImgElement: photos come from our own API, already resized.
            <img
              src={item.coverUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="card-photo size-full object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-full items-center justify-center p-space-3 text-center text-sm text-ink-muted"
            >
              {t("noPhoto")}
            </span>
          )}
        </div>
        <div className="flex min-w-space-0 flex-col gap-space-0-5 px-space-2-5 pt-space-2 pb-space-3">
          <span data-testid="card-name" className="truncate font-title text-ui leading-tight">
            {name}
          </span>
          <span className="truncate text-meta text-ink-muted">
            {typeName ? t("meta", { type: typeName, shop }) : shop}
          </span>
          {item.priority && (
            <span className="self-start rounded-pill bg-accent px-space-2 py-space-0-5 text-tag font-bold text-accent-ink">
              {t("priority")}
            </span>
          )}
          {asked === null && item.product.captureStatus === "manual" && item.product.priceCents !== null && (
            <span className="truncate text-meta text-ink-muted">{t("manualPrice")}</span>
          )}
          {item.why && <span className="truncate text-meta text-ink-muted italic">{t("why", { why: item.why })}</span>}
          {/* The price as a powder-pink clothing tag that fits its content (mockup .pricetag): a drop shows inside it,
              crossed price and « −20 € ». Room on the right for « … ». */}
          <span className="flex min-w-space-0 pt-space-1 pr-space-7">
            <span data-testid="price-tag" className="price-tag max-w-full tabular-nums">
              <span className="whitespace-nowrap">{price}</span>
              {drop !== null && item.product.compareAtCents !== null && (
                <s className="font-regular whitespace-nowrap">
                  {formatAmount(locale, item.product.compareAtCents, currency)}
                </s>
              )}
              {drop !== null && (
                <span data-testid="card-drop" className="whitespace-nowrap">
                  −{formatAmount(locale, drop, currency)}
                </span>
              )}
            </span>
          </span>
        </div>
      </Wrapper>
      <div className="pointer-events-none absolute inset-x-space-0 top-space-0 aspect-3/4">
        <span data-testid="card-step" className="clothing-tag absolute top-space-2 left-space-2">
          {stepLabel}
        </span>
        {selection ? (
          <span
            aria-hidden="true"
            className={`absolute top-space-3 right-space-3 flex size-space-6 items-center justify-center rounded-full border-2 ${
              selection.selected ? "border-accent bg-accent text-accent-ink" : "border-surface-raised bg-ink/20"
            }`}
          >
            {selection.selected && <Tick />}
          </span>
        ) : (
          quick &&
          item.inOrderDraft && (
            <span
              data-testid="card-taken"
              role="img"
              aria-label={t("taken")}
              className="absolute top-space-7 left-space-2 flex size-control-2xs items-center justify-center rounded-mark bg-button-bg text-button-ink"
            >
              <Tick draw />
            </span>
          )
        )}
        {quick && (
          <div className="card-quick pointer-events-none absolute inset-x-space-2 bottom-space-2 flex gap-space-2 sm:inset-x-space-3 sm:bottom-space-3">
            <button
              type="button"
              data-testid="card-preview"
              aria-label={t("previewOf", { name })}
              onClick={() => quick.onPreview?.(item)}
              className={`hit-area pointer-events-auto relative flex h-control-sm min-w-control-sm items-center justify-center rounded-button border border-line bg-surface-raised px-space-2 text-caption font-strong text-ink sm:h-control-lg sm:flex-1 sm:text-sm ${focusRing}`}
            >
              {/* A narrow phone card has no room for both words: the eye says « Aperçu » (its name says it too). */}
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="size-space-4 sm:hidden"
              >
                <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" />
                <circle cx="8" cy="8" r="2" />
              </svg>
              <span className="hidden sm:inline">{t("preview")}</span>
            </button>
            <button
              type="button"
              data-testid="card-take"
              aria-pressed={item.inOrderDraft}
              aria-label={t(item.inOrderDraft ? "removeOf" : "takeOf", { name })}
              onClick={(event) =>
                quick.onTake?.(item, event.currentTarget.closest("li")?.querySelector("[data-photo]"))
              }
              className={`hit-area pointer-events-auto relative h-control-sm min-w-space-0 flex-1 rounded-button border px-space-2 text-caption font-strong whitespace-nowrap sm:h-control-lg sm:text-sm ${focusRing} ${
                // Taken: the soft pressed look (hint fill, accent edge, ink text), so « Retirer » reads as a state.
                item.inOrderDraft ? "border-accent bg-hint text-ink" : "border-transparent bg-button-bg text-button-ink"
              }`}
            >
              {t(item.inOrderDraft ? "remove" : "take")}
            </button>
          </div>
        )}
      </div>
      {actions && !selection ? (
        <>
          <LoveLevelPill
            item={item}
            onChange={actions.onChanged}
            reload={actions.reload}
            open={pickerOpen}
            onOpenChange={changePicker}
            placement="top-space-1 right-space-1"
          />
          <ItemMenu item={item} onChanged={actions.onChanged} onTrashed={actions.onTrashed} reload={actions.reload} />
        </>
      ) : (
        <LoveLevelBadge item={item} placement="top-space-7 left-space-2" />
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
        className={`flex flex-col rounded-card text-left ${focusRing} ${selection.selected ? "ring-2 ring-accent" : ""}`}
      >
        {children}
      </button>
    );
  }
  if (!linked) return <div className="flex flex-col">{children}</div>;
  return (
    <Link href={href} {...(onClick ? { onClick } : {})} className={`flex flex-col rounded-card ${focusRing}`}>
      {children}
    </Link>
  );
}
