"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { buttonClass } from "./ui";

export type ViewerPhoto = { url: string; width: number; height: number };

const control = `${buttonClass} min-h-touch-target`;

/**
 * Full-screen viewer on the native `<dialog>` (like `Dialog`): the browser traps the focus, closes on Escape and gives
 * the focus back to the thumbnail that opened it. The photos sit side by side in a scroll-snap track, so swiping is the
 * browser's own scrolling. A click on the photo toggles between « fitted » (whole photo, never cropped) and « actual
 * size » (natural pixels, the slide scrolls; ←/→ then pan it instead of changing photo). Changing photo goes back to
 * « fitted ». `index === null` is closed.
 */
export function PhotoViewer({
  photos,
  index,
  alt,
  onClose,
}: {
  photos: ViewerPhoto[];
  index: number | null;
  alt: string;
  onClose: () => void;
}) {
  const t = useTranslations("Media.viewer");
  const dialog = useRef<HTMLDialogElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const currentRef = useRef(0);
  const pending = useRef<number | null>(null);
  const [current, setCurrent] = useState(0);
  const [actual, setActual] = useState(false);
  const actualRef = useRef(false);
  currentRef.current = current;
  actualRef.current = actual;
  const open = index !== null;
  const total = photos.length;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  // On opening: show the photo asked for, fitted.
  useEffect(() => {
    if (index === null) return;
    pending.current = null;
    setActual(false);
    setCurrent(index);
    const element = track.current;
    if (element) element.scrollTo({ left: index * element.clientWidth, behavior: "instant" });
  }, [index]);

  function go(target: number) {
    const element = track.current;
    if (!element || target < 0 || target >= total) return;
    pending.current = target;
    // The CSS `scroll-smooth motion-reduce:scroll-auto` of the track decides whether it animates.
    element.scrollTo({ left: target * element.clientWidth });
    setCurrent(target);
    setActual(false);
  }

  // On the document, not the dialog: the focus falls back to the body when the button just pressed gets disabled.
  const step = useRef(go);
  step.current = go;
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      if (actualRef.current) {
        // In actual size the arrows pan the photo shown, a quarter of the screen at a time. Not the track's own
        // scrolling either: that would snap to the next photo.
        event.preventDefault();
        const slide = track.current?.children[currentRef.current];
        const direction = event.key === "ArrowRight" ? 1 : -1;
        if (slide instanceof HTMLElement) slide.scrollBy({ left: direction * Math.round(slide.clientWidth / 4) });
        return;
      }
      const base = pending.current ?? currentRef.current;
      if (event.key === "ArrowRight") step.current(base + 1);
      if (event.key === "ArrowLeft") step.current(base - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-modal="true"
      aria-label={alt}
      data-zoom={actual ? "actual" : "fit"}
      onClose={onClose}
      className="m-0 size-full max-h-none max-w-none bg-media-backdrop p-space-0 text-ink backdrop:bg-ink/40"
    >
      {open && (
        <div className="relative size-full">
          <section
            ref={track}
            data-testid="viewer-track"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard.
            tabIndex={0}
            aria-label={alt}
            onScroll={(event) => {
              const element = event.currentTarget;
              if (element.clientWidth === 0) return;
              const shown = Math.round(element.scrollLeft / element.clientWidth);
              // While a button or key animates the scroll, the passing positions are not the photo being shown.
              if (pending.current === null && shown !== currentRef.current) {
                setCurrent(shown);
                setActual(false);
              } else if (shown === pending.current) pending.current = null;
            }}
            onScrollEnd={() => {
              pending.current = null;
            }}
            className="flex size-full snap-x snap-mandatory overflow-x-auto scroll-smooth motion-reduce:scroll-auto"
          >
            {photos.map((photo, position) => (
              <div
                key={photo.url}
                data-testid="viewer-slide"
                className="flex size-full shrink-0 snap-center snap-always overflow-auto"
              >
                {/* biome-ignore lint/performance/noImgElement: photos come from our own API, sized by it. */}
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: the zoom button below does the same for the keyboard. */}
                <img
                  src={photo.url}
                  width={photo.width}
                  height={photo.height}
                  alt={total > 1 ? `${alt} (${position + 1}/${total})` : alt}
                  onClick={() => setActual((value) => !value)}
                  className={
                    actual
                      ? "m-auto max-h-none max-w-none shrink-0 cursor-zoom-out"
                      : "size-full cursor-zoom-in object-contain"
                  }
                />
              </div>
            ))}
          </section>

          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-space-2 p-space-3">
            {total > 1 && (
              <p aria-live="polite" className="rounded-button bg-surface-raised px-space-3 py-space-2 text-sm">
                {t("counter", { current: current + 1, total })}
              </p>
            )}
            <div className="pointer-events-auto ml-auto flex gap-space-2">
              <button type="button" onClick={() => setActual((value) => !value)} className={control}>
                {actual ? t("fit") : t("actualSize")}
              </button>
              <button type="button" onClick={onClose} className={control}>
                {t("close")}
              </button>
            </div>
          </div>

          {total > 1 && (
            <>
              <button
                type="button"
                aria-label={t("previous")}
                disabled={current === 0}
                onClick={() => go((pending.current ?? current) - 1)}
                className={`${control} absolute left-space-3 top-1/2 -translate-y-1/2`}
              >
                <span aria-hidden="true">‹</span>
              </button>
              <button
                type="button"
                aria-label={t("next")}
                disabled={current === total - 1}
                onClick={() => go((pending.current ?? current) + 1)}
                className={`${control} absolute right-space-3 top-1/2 -translate-y-1/2`}
              >
                <span aria-hidden="true">›</span>
              </button>
            </>
          )}
        </div>
      )}
    </dialog>
  );
}
