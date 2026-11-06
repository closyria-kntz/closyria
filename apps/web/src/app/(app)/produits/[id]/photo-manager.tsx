"use client";

import { type ItemPhotoView, type ItemView, MAX_ITEM_PHOTOS } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AddPhotoDialog } from "@/components/add-photo-dialog";
import { Dialog } from "@/components/dialog";
import { PhotoViewer } from "@/components/photo-viewer";
import { buttonClass, primaryButtonClass } from "@/components/ui";
import { pushUndo } from "@/lib/undo";
import { patchItem, removePhoto, undoWith } from "@/lib/wardrobe-client";

/** Stand-in for a sheet without photo (hand-entered, shop blocked): tokens only, same 3:4 frame. */
export function PhotoPlaceholder({ label }: { label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="flex aspect-3/4 w-full items-center justify-center rounded-card border border-line bg-media-backdrop p-space-3 text-center text-sm text-ink-muted"
    >
      <span aria-hidden="true">{label}</span>
    </div>
  );
}

const touch = "min-h-touch-target";

function Frame({
  photo,
  alt,
  openLabel,
  onOpen,
}: {
  photo: ItemPhotoView;
  alt: string;
  openLabel: string;
  onOpen: () => void;
}) {
  return (
    // The whole photo in a 3:4 frame on the media backdrop, never cropped (visual direction §6).
    <button
      type="button"
      aria-label={openLabel}
      onClick={onOpen}
      className="aspect-3/4 w-full overflow-hidden rounded-card bg-media-backdrop focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline-solid"
    >
      {/* biome-ignore lint/performance/noImgElement: photos come from our own API, sized by it. */}
      <img
        src={photo.url}
        width={photo.width}
        height={photo.height}
        alt={alt}
        loading="lazy"
        className="size-full object-contain"
      />
    </button>
  );
}

/** Her private photos first (add, remove, choose the thumbnail), then the shop's. */
export function PhotoManager({
  item,
  onChange,
  reload,
}: {
  item: ItemView;
  onChange: (item: ItemView) => void;
  reload: () => Promise<void>;
}) {
  const t = useTranslations("Item");
  const tMedia = useTranslations("Media");
  const [viewing, setViewing] = useState<{ group: "private" | "shop"; index: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ItemPhotoView | null>(null);
  const name = item.name ?? item.product.shop.name;
  const mine = item.photos.filter((photo) => photo.source === "private");
  const shop = item.photos.filter((photo) => photo.source === "shop");
  const fail = (code: string) => setError(t(`errors.${code}` as "errors.failed"));

  async function remove(photo: ItemPhotoView) {
    setBusy(true);
    setError(null);
    const result = await removePhoto(item.id, photo.id);
    setConfirming(null);
    if (result.ok) {
      onChange(result.item);
      pushUndo(t("toast.photoRemoved"), null);
    } else fail(result.error);
    setBusy(false);
  }

  async function cover(mediaId: string | null) {
    setBusy(true);
    setError(null);
    const result = await patchItem(item.id, { coverMediaId: mediaId });
    if (result.ok) {
      onChange(result.item);
      pushUndo(t(mediaId ? "toast.cover" : "toast.coverDefault"), undoWith(result.undo, reload));
    } else fail(result.error);
    setBusy(false);
  }

  return (
    <section aria-labelledby="photos-title" className="flex flex-col gap-space-3">
      <h2 id="photos-title" className="text-sm font-strong">
        {t("photos.title")}
      </h2>
      {item.photos.length === 0 && <PhotoPlaceholder label={t("photos.empty")} />}

      {mine.length > 0 && (
        <ul aria-label={t("photos.private")} className="grid grid-cols-2 gap-space-2">
          {mine.map((photo, index) => (
            <li key={photo.id} className="flex flex-col gap-space-2">
              <Frame
                photo={photo}
                alt={t("photos.alt", { n: index + 1, name })}
                openLabel={tMedia("viewer.open", { n: index + 1 })}
                onOpen={() => setViewing({ group: "private", index })}
              />
              <div className="flex flex-wrap gap-space-1">
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={item.coverMediaId === photo.id}
                  onClick={() => cover(item.coverMediaId === photo.id ? null : photo.id)}
                  className={`${buttonClass} ${touch} aria-pressed:bg-surface-strong aria-pressed:font-strong`}
                >
                  {item.coverMediaId === photo.id ? t("photos.isCover") : t("photos.cover")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirming(photo)}
                  className={`${buttonClass} ${touch}`}
                >
                  {t("photos.remove")}
                  <span className="sr-only"> {index + 1}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col items-start gap-space-1">
        {mine.length < MAX_ITEM_PHOTOS && (
          <button type="button" disabled={busy} onClick={() => setAdding(true)} className={`${buttonClass} ${touch}`}>
            {t("photos.add")}
          </button>
        )}
        <p className="text-sm text-ink-muted">{t("photos.count", { count: mine.length, max: MAX_ITEM_PHOTOS })}</p>
        {busy && (
          <p role="status" className="text-sm text-ink-muted">
            {t("photos.uploading")}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      <AddPhotoDialog open={adding} onClose={() => setAdding(false)} itemId={item.id} onChange={onChange} />

      <Dialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={t("photos.confirmTitle")}
        closeLabel={t("photos.keep")}
      >
        <p>{t("photos.confirmBody")}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => confirming && remove(confirming)}
          className={`${primaryButtonClass} ${touch}`}
        >
          {t("photos.confirm")}
        </button>
      </Dialog>

      {shop.length > 0 && (
        <ul aria-label={t("photos.shop")} className="grid grid-cols-2 gap-space-2">
          {shop.map((photo, index) => (
            <li key={photo.id}>
              <Frame
                photo={photo}
                alt={t("photos.alt", { n: index + 1, name })}
                openLabel={tMedia("viewer.open", { n: index + 1 })}
                onOpen={() => setViewing({ group: "shop", index })}
              />
            </li>
          ))}
        </ul>
      )}

      <PhotoViewer
        photos={viewing?.group === "shop" ? shop : mine}
        index={viewing?.index ?? null}
        alt={name}
        onClose={() => setViewing(null)}
      />
    </section>
  );
}
