"use client";

import type { ItemView, LoveLevelView } from "@closyria/shared";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type PointerEvent, useEffect, useId, useRef } from "react";
import { levelOf } from "@/lib/love-levels";
import { SquareCheck } from "./square-check";
import { buttonClass, focusRing } from "./ui";

/** Dragging the top of the preview down by this much closes it (phone gesture, works with a mouse too). */
export const PREVIEW_DRAG_CLOSE_PX = 80;

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
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const checkId = useId();
  // The drag in progress: where it started and how far down it went; the sheet follows the finger.
  const drag = useRef<{ start: number; offset: number } | null>(null);
  const open = item !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (!open) {
      drag.current = null;
      dialog.style.removeProperty("translate");
    }
  }, [open]);

  function resetDrag() {
    drag.current = null;
    ref.current?.style.removeProperty("translate");
  }
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { start: event.clientY, offset: 0 };
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current.offset = Math.max(0, event.clientY - drag.current.start);
    ref.current?.style.setProperty("translate", `0 ${drag.current.offset}px`);
  };
  const endDrag = () => {
    const far = (drag.current?.offset ?? 0) >= PREVIEW_DRAG_CLOSE_PX;
    resetDrag();
    if (far) onClose();
  };

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
  const size = item ? [item.sizeLabel, item.sizeNote && `« ${item.sizeNote} »`].filter(Boolean).join(" · ") : "";

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click on the backdrop is a mouse shortcut; Escape and « Fermer » are the keyboard ways.
    <dialog
      ref={ref}
      aria-modal="true"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => event.target === ref.current && onClose()}
      className="m-space-0 mt-auto h-5/6 max-h-full w-full max-w-full overflow-hidden rounded-t-card border border-line bg-surface-raised p-space-0 text-ink shadow-lifted backdrop:bg-ink/40 md:mt-space-0 md:mr-space-0 md:ml-auto md:h-full md:w-3/5 md:max-w-panel md:rounded-l-card md:rounded-tr-none"
    >
      {item && (
        <div className="flex h-full flex-col">
          <div
            data-testid="preview-handle"
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={resetDrag}
            className="flex touch-none flex-col gap-space-1 border-b border-line px-space-4 pt-space-2 pb-space-2 select-none"
          >
            <span aria-hidden="true" className="mx-auto h-space-1 w-space-7 rounded-full bg-line md:hidden" />
            <div className="flex items-center justify-between gap-space-3">
              <p className="text-sm text-ink-muted md:invisible">{t("closeHint")}</p>
              <button
                type="button"
                onClick={onClose}
                className={`${buttonClass} min-h-touch-target shrink-0 font-strong`}
              >
                <span aria-hidden="true">×</span>
                {t("close")}
              </button>
            </div>
          </div>

          <div
            data-testid="preview-body"
            className={`grid flex-1 content-start gap-space-4 overflow-y-auto overscroll-contain p-space-4 ${photos.length > 0 ? "md:grid-cols-2" : ""}`}
          >
            {photos.length > 0 && (
              <div className="flex snap-x snap-mandatory gap-space-2 overflow-x-auto">
                {photos.map((url) => (
                  // biome-ignore lint/performance/noImgElement: photos come from our own API, already resized.
                  <img
                    key={url}
                    src={url}
                    alt=""
                    decoding="async"
                    className={`aspect-3/4 shrink-0 snap-start rounded-card bg-media-backdrop object-cover ${photos.length > 1 ? "w-4/5" : "w-full"}`}
                  />
                ))}
              </div>
            )}
            <div className="flex flex-col gap-space-3">
              <div className="flex flex-col gap-space-1">
                {item.brand && <p className="text-sm text-ink-muted uppercase">{item.brand}</p>}
                <h2 id={titleId} className="font-display text-lead font-strong text-balance">
                  <span className="sr-only">{t("titlePrefix")} </span>
                  {name}
                </h2>
                <p className="font-strong tabular-nums">{price === null ? tRow("unknownPrice") : money(price)}</p>
              </div>
              {(level || item.priority) && (
                <ul className="flex flex-wrap gap-space-2 text-sm">
                  {level && (
                    <li className="rounded-button border border-line px-space-2">
                      {level.emoji} {level.label}
                    </li>
                  )}
                  {item.priority && (
                    <li className="rounded-button border border-line px-space-2">{tRow("priority")}</li>
                  )}
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
              <Link
                href={`/produits/${item.product.id}`}
                className={`self-start rounded-sm text-sm text-ink-muted underline underline-offset-2 hover:text-ink ${focusRing}`}
              >
                {t("full")}
              </Link>
            </div>
          </div>

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
        </div>
      )}
    </dialog>
  );
}
