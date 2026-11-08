"use client";

import { useTranslations } from "next-intl";
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { PHOTO_CLICK_DELAY_MS, photoClickPlan } from "@/components/level-picker-logic";
import { PhotoViewer } from "@/components/photo-viewer";
import { focusRing } from "@/components/ui";

/** Her own photos, the shop's photos of her item, or the photos of a sheet she has not kept. */
export type PhotoGroup = "private" | "shop" | "product";

export type GalleryPhoto = { id: string; url: string; width: number; height: number; group: PhotoGroup };

type Props = {
  photos: GalleryPhoto[];
  /** The big photo's text alternative (the product's name). */
  alt: string;
  /** Text alternative of the thumbnails: « Photo {n} de {name} ». */
  thumbAlt: (n: number) => string;
  /** The names of the thumbnail lists, per group (« Mes photos », « Photos de la boutique »). */
  groupLabels: Partial<Record<PhotoGroup, string>>;
  /** Thumbnails even for a single photo (her item: the lists are where her photos are counted). */
  alwaysThumbs?: boolean;
  /** Laid on the big photo, top left (her level emoji). */
  overlay?: ReactNode;
  /** A double tap on the big photo (her item: the 4 levels); a single click still opens the viewer. */
  onDoubleTap?: () => void;
  /** Under the thumbnails, about the photo on show (add, remove, thumbnail). */
  footer?: (current: GalleryPhoto | null) => ReactNode;
  /** In place of the big photo when there is none. */
  empty?: ReactNode;
  /** Shows this photo in the big arch whenever it changes (her photo just added). */
  selectId?: string | null;
};

const roundButton = `glass flex size-touch-target items-center justify-center rounded-full text-ink ${focusRing}`;

function Arrow({ back }: { back?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-space-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={back ? "M10 3L5 8l5 5" : "M6 3l5 5-5 5"} />
    </svg>
  );
}

/**
 * The sheet's gallery (spec §6): one big arch, the arrows and the dots that stretch for the photo on show, the
 * thumbnails in small arches below. A click on the big photo opens the full-screen viewer on its group (her photos,
 * or the shop's); with `onDoubleTap`, the click waits a beat and a second one calls it instead.
 */
export function ProductGallery({
  photos,
  alt,
  thumbAlt,
  groupLabels,
  alwaysThumbs = false,
  overlay,
  onDoubleTap,
  footer,
  empty,
  selectId = null,
}: Props) {
  const t = useTranslations("Media");
  const [index, setIndex] = useState(0);
  const [viewing, setViewing] = useState<number | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(openTimer.current), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new `selectId` moves the big photo, not every render.
  useEffect(() => {
    if (selectId === null) return;
    const found = photos.findIndex((photo) => photo.id === selectId);
    if (found >= 0) setIndex(found);
  }, [selectId]);
  const shown = Math.min(index, Math.max(0, photos.length - 1));
  const current = photos[shown] ?? null;
  const group = current ? photos.filter((photo) => photo.group === current.group) : [];
  const inGroup = current ? group.indexOf(current) : -1;
  const several = photos.length > 1;

  const label = (photo: GalleryPhoto, n: number, kind: "open" | "show") => {
    if (kind === "open") {
      return photo.group === "private"
        ? t("viewer.openMine", { n })
        : photo.group === "shop"
          ? t("viewer.openShop", { n })
          : t("viewer.open", { n });
    }
    return photo.group === "private"
      ? t("gallery.showMine", { n })
      : photo.group === "shop"
        ? t("gallery.showShop", { n })
        : t("gallery.show", { n });
  };

  const onPhotoClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (!onDoubleTap) return setViewing(inGroup);
    const plan = photoClickPlan(event.nativeEvent);
    clearTimeout(openTimer.current);
    if (plan === "pass") setViewing(inGroup);
    else if (plan === "wait") openTimer.current = setTimeout(() => setViewing(inGroup), PHOTO_CLICK_DELAY_MS);
    else if (plan === "pick") onDoubleTap();
  };

  const step = (by: number) => setIndex((shown + by + photos.length) % photos.length);
  const groups = (["private", "shop", "product"] as const)
    .map((name) => ({ name, items: photos.filter((photo) => photo.group === name) }))
    .filter((entry) => entry.items.length > 0);

  return (
    <div className="flex flex-col items-center gap-space-4">
      <div className="relative w-full max-w-narrow">
        <div data-testid="gallery-main" className="arch relative aspect-3/4 overflow-hidden bg-media-backdrop">
          {current ? (
            <button
              type="button"
              data-testid="gallery-photo"
              aria-label={label(current, inGroup + 1, "open")}
              onClick={onPhotoClick}
              className={`arch size-full ${focusRing}`}
            >
              {/* biome-ignore lint/performance/noImgElement: photos come from our own API, sized by it. */}
              <img
                src={current.url}
                width={current.width}
                height={current.height}
                alt={alt}
                className="size-full object-contain"
              />
            </button>
          ) : (
            empty
          )}
          {several && (
            <div className="absolute inset-x-space-0 bottom-space-4 flex items-center justify-center gap-space-3">
              <button type="button" aria-label={t("viewer.previous")} onClick={() => step(-1)} className={roundButton}>
                <Arrow back />
              </button>
              <div
                data-testid="gallery-dots"
                aria-hidden="true"
                className="glass flex items-center gap-space-1 rounded-full px-space-3 py-space-2"
              >
                {photos.map((photo, n) => (
                  <span
                    key={photo.id}
                    data-dot
                    data-current={n === shown}
                    className={`h-space-2 rounded-full transition-all duration-slow ease-emphasized ${
                      n === shown ? "w-space-5 bg-ink" : "w-space-2 bg-ink-muted"
                    }`}
                  />
                ))}
              </div>
              <button type="button" aria-label={t("viewer.next")} onClick={() => step(1)} className={roundButton}>
                <Arrow />
              </button>
            </div>
          )}
        </div>
        {overlay}
      </div>

      {(several || (alwaysThumbs && photos.length > 0)) && (
        <div data-testid="gallery-thumbs" className="flex flex-wrap justify-center gap-space-3">
          {groups.map(({ name, items }) => (
            <ul key={name} aria-label={groupLabels[name]} className="flex flex-wrap justify-center gap-space-3">
              {items.map((photo, n) => (
                <li key={photo.id}>
                  <button
                    type="button"
                    aria-label={label(photo, n + 1, "show")}
                    aria-pressed={photo === current}
                    onClick={() => setIndex(photos.indexOf(photo))}
                    className={`arch block aspect-3/4 w-space-8 overflow-hidden bg-media-backdrop aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-ink aria-pressed:outline-solid ${focusRing}`}
                  >
                    {/* biome-ignore lint/performance/noImgElement: photos come from our own API, sized by it. */}
                    <img
                      src={photo.url}
                      width={photo.width}
                      height={photo.height}
                      alt={thumbAlt(n + 1)}
                      loading="lazy"
                      className="size-full object-contain"
                    />
                  </button>
                </li>
              ))}
            </ul>
          ))}
        </div>
      )}

      {footer?.(current)}

      <PhotoViewer photos={group} index={viewing} alt={alt} onClose={() => setViewing(null)} />
    </div>
  );
}
