"use client";

import { type CatalogCard, DEFAULT_LOVE_LEVEL, type ItemView } from "@closyria/shared";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { GRID_CLASS } from "@/components/item-grid";
import { focusRing } from "@/components/ui";
import { requestAccountPrompt } from "@/lib/account-prompt-request";
import { formatAmount } from "@/lib/budget";
import { DISCOVER_PATH } from "@/lib/catalogue-client";
import { formatPrice, priceDropCents } from "@/lib/price";
import { profileHref, useCurrentProfile } from "@/lib/profile-context";
import { pushUndo } from "@/lib/undo";
import { createItem, undoWith, wishCreate } from "@/lib/wardrobe-client";

/** The sheet of a catalogue article, with her profile when she chose one. */
export function useSheetHref(): (productId: string) => string {
  const current = useCurrentProfile();
  return useCallback(
    (productId: string) => profileHref(`${DISCOVER_PATH}/${productId}`, current.id, current.isDefault),
    [current.id, current.isDefault],
  );
}

/**
 * « Je le veux »: the same gesture as keeping a product from its sheet (« Ajouter à mes envies », « J’aime »), for the
 * current profile, with « Annuler ». Already kept: her item as it was (nothing to undo). `onUndone` runs once the
 * wish is taken back. Resolves with her item, or null when it failed (the toast says so).
 */
export function useWant(): (productId: string, onUndone: () => Promise<void>) => Promise<ItemView | null> {
  const tItem = useTranslations("Item");
  const tCard = useTranslations("Discover.card");
  const current = useCurrentProfile();
  return useCallback(
    async (productId, onUndone) => {
      const result = await createItem(
        wishCreate(
          { productId, ...(current.id ? { profileId: current.id } : {}) },
          { loveLevel: DEFAULT_LOVE_LEVEL, priority: false, why: "" },
        ),
      );
      if (!result.ok) {
        pushUndo(tCard("wantFailed"), null);
        return null;
      }
      pushUndo(tItem("toast.wish"), result.created ? undoWith(result.undo, onUndone) : null);
      void requestAccountPrompt("save");
      return result.item;
    },
    [current.id, tItem, tCard],
  );
}

/** The heart of « Je le veux »: drawn, filled once the article is in her wishes. */
export function HeartIcon({ filled, className = "size-space-4" }: { filled: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      className={`${className} shrink-0`}
    >
      <path d="M8 13.5S2 10 2 5.9A3.1 3.1 0 0 1 8 4.4a3.1 3.1 0 0 1 6 1.5C14 10 8 13.5 8 13.5z" />
    </svg>
  );
}

/**
 * One catalogue article (Découvrir, spec §3.1), drawn like a card of « Mes articles » (mockup .card): its 3:4 photo
 * with « Ta taille en stock » as an ochre clothing tag top left when true and « Je le veux » written under the photo
 * (« Dans tes envies », heart filled, once it is); then the name (Gloock), the shop, and the price in the powder-pink
 * price tag (crossed price and « −20 € » inside it). The card opens the article's sheet.
 */
export function CatalogueCard({
  card,
  onWanted,
}: {
  card: CatalogCard;
  /** Her wish was saved (`true`) or taken back (`false`). */
  onWanted: (productId: string, wanted: boolean) => void;
}) {
  const t = useTranslations("Discover.card");
  const locale = useLocale();
  const sheetHref = useSheetHref();
  const want = useWant();
  const [busy, setBusy] = useState(false);
  const drop = priceDropCents(card.priceCents, card.previousPriceCents);

  async function onWant() {
    setBusy(true);
    const item = await want(card.productId, async () => onWanted(card.productId, false));
    setBusy(false);
    if (item) onWanted(card.productId, true);
  }

  return (
    <li
      className="card card-rise group relative flex flex-col rounded-card bg-surface-raised"
      data-testid="catalogue-card"
    >
      <Link href={sheetHref(card.productId)} className={`flex flex-col rounded-card ${focusRing}`}>
        <div className="relative aspect-3/4 overflow-hidden rounded-t-card bg-media-backdrop">
          {/* biome-ignore lint/performance/noImgElement: photos come from our own API, already resized. */}
          <img
            src={card.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="card-photo size-full object-cover"
          />
        </div>
        {/* Room at the bottom of the photo for « Je le veux », laid over it (outside the link). */}
        <div className="flex min-w-space-0 flex-col gap-space-0-5 px-space-2-5 pt-space-2 pb-space-3">
          <span data-testid="card-name" className="truncate font-title text-ui leading-tight">
            {card.name}
          </span>
          <span className="truncate text-meta text-ink-muted">{card.shop.name}</span>
          <span className="flex min-w-space-0 pt-space-1">
            <span data-testid="price-tag" className="price-tag max-w-full tabular-nums">
              <span className="whitespace-nowrap">{formatPrice(locale, card.priceCents, card.currency)}</span>
              {drop !== null && card.previousPriceCents !== null && (
                <s className="font-regular whitespace-nowrap">
                  <span className="sr-only">{t("previousPrice")} </span>
                  {formatAmount(locale, card.previousPriceCents, card.currency)}
                </s>
              )}
              {drop !== null && (
                <span data-testid="card-drop" className="whitespace-nowrap">
                  −{formatAmount(locale, drop, card.currency)}
                </span>
              )}
            </span>
          </span>
        </div>
      </Link>
      <div className="pointer-events-none absolute inset-x-space-0 top-space-0 aspect-3/4">
        {card.sizeInStock === true && (
          <span data-testid="card-size" className="clothing-tag absolute top-space-2 left-space-2">
            {t("mySize")}
          </span>
        )}
        <div className="absolute inset-x-space-2 bottom-space-2 flex sm:inset-x-space-3 sm:bottom-space-3">
          {card.wanted ? (
            <span
              data-testid="card-wanted"
              className="flex h-control-sm min-w-space-0 flex-1 items-center justify-center gap-space-1-5 rounded-button border border-accent bg-hint px-space-2 text-caption font-strong whitespace-nowrap text-ink sm:h-control-lg sm:text-sm"
            >
              <HeartIcon filled />
              {t("wanted")}
            </span>
          ) : (
            <button
              type="button"
              data-testid="card-want"
              disabled={busy}
              aria-label={t("wantOf", { name: card.name })}
              onClick={() => void onWant()}
              className={`hit-area pointer-events-auto relative flex h-control-sm min-w-space-0 flex-1 items-center justify-center gap-space-1-5 rounded-button bg-button-bg px-space-2 text-caption font-strong whitespace-nowrap text-button-ink disabled:opacity-60 sm:h-control-lg sm:text-sm ${focusRing}`}
            >
              <HeartIcon filled={false} />
              {t("want")}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/** The catalogue's grid: the columns of « Mes articles » (2 on a phone, 3 on a tablet, 4 from 64 rem). */
export function CatalogueGrid({
  label,
  cards,
  onWanted,
}: {
  label: string;
  cards: readonly CatalogCard[];
  onWanted: (productId: string, wanted: boolean) => void;
}) {
  return (
    <ul aria-label={label} data-testid="catalogue-grid" className={GRID_CLASS}>
      {cards.map((card) => (
        <CatalogueCard key={card.productId} card={card} onWanted={onWanted} />
      ))}
    </ul>
  );
}
