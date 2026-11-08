"use client";

import type { ItemView } from "@closyria/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { formatAmount } from "@/lib/budget";
import { formatOptionalPrice, priceDropCents } from "@/lib/price";
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
  /** Show the stage (« Vendu », « Renvoyé »): for the items that the view's own stage does not describe. */
  showStage: boolean;
};

/**
 * One item in the grid (refonte, shape C): a 3:4 photo that fills its frame, her level emoji top left (tucked in from
 * the curve), « … » top right with the « taken » tick just under it, « Prioritaire » under the emoji; under the photo
 * the shop, the name (Fraunces), the price with the crossed one and the « −20 € » drop beside it, her opinion.
 */
export function ItemCard({ item, actions, selection, showStage, linked = true, children }: Props) {
  const t = useTranslations("Views.card");
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
  return (
    <li className="card card-rise group relative flex flex-col" data-testid="item-card">
      <Wrapper
        linked={linked}
        href={href}
        onClick={onPhotoClick}
        selection={selection}
        onToggle={() => selection?.onToggle(item.id)}
      >
        <div data-photo className="photo-shape relative aspect-3/4 overflow-hidden bg-media-backdrop">
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
          {showStage && (item.stage === "sold" || item.stage === "returned") && (
            <span className="absolute right-space-2 bottom-space-2 rounded-full bg-ink px-space-2 py-space-1 text-sm text-surface-raised">
              {tStage(item.stage)}
            </span>
          )}
        </div>
        <div className="flex min-w-space-0 flex-col gap-space-1 px-space-1">
          <span className="truncate text-sm text-ink-muted">{item.product.shop.name}</span>
          <span className="truncate font-display text-lead leading-tight">{name}</span>
          <span className="flex flex-wrap items-center gap-x-space-2 gap-y-space-1 tabular-nums">
            {price}
            {drop !== null && item.product.compareAtCents !== null && (
              <s className="text-sm text-ink-muted">{formatAmount(locale, item.product.compareAtCents, currency)}</s>
            )}
            {drop !== null && (
              <span
                data-testid="card-drop"
                className="rounded-full bg-success-soft px-space-2 py-space-1 text-caption font-strong text-success"
              >
                −{formatAmount(locale, drop, currency)}
              </span>
            )}
          </span>
          {asked === null && item.product.captureStatus === "manual" && item.product.priceCents !== null && (
            <span className="truncate text-sm text-ink-muted">{t("manualPrice")}</span>
          )}
          {item.why && <span className="truncate text-sm text-ink-muted italic">{t("why", { why: item.why })}</span>}
        </div>
      </Wrapper>
      <div className="pointer-events-none absolute inset-x-space-0 top-space-0 aspect-3/4">
        {item.priority && (
          <span className="absolute top-space-7 left-space-3 mt-space-2 rounded-full bg-accent px-space-2 py-space-1 text-caption font-strong text-accent-ink">
            {t("priority")}
          </span>
        )}
        {selection ? (
          <span
            aria-hidden="true"
            className={`absolute top-space-7 right-space-3 mt-space-2 flex size-space-6 items-center justify-center rounded-full border-2 ${
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
              className="absolute top-space-7 right-space-3 mt-space-2 flex size-space-6 items-center justify-center rounded-md bg-button-bg text-button-ink"
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
              className={`glass pointer-events-auto flex min-h-touch-target min-w-touch-target items-center justify-center rounded-button px-space-2 text-sm font-strong text-ink sm:flex-1 ${focusRing}`}
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
              className={`pointer-events-auto min-h-touch-target min-w-space-0 flex-1 rounded-button px-space-2 text-sm font-strong whitespace-nowrap ${focusRing} ${
                item.inOrderDraft ? "glass text-ink" : "bg-button-bg text-button-ink"
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
        className={`flex flex-col gap-space-3 rounded-card text-left ${focusRing} ${selection.selected ? "ring-2 ring-accent" : ""}`}
      >
        {children}
      </button>
    );
  }
  if (!linked) return <div className="flex flex-col gap-space-3">{children}</div>;
  return (
    <Link
      href={href}
      {...(onClick ? { onClick } : {})}
      className={`flex flex-col gap-space-3 rounded-card ${focusRing}`}
    >
      {children}
    </Link>
  );
}
