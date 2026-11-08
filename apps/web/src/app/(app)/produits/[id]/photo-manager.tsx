"use client";

import { type ItemPhotoView, type ItemView, MAX_ITEM_PHOTOS } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AddPhotoDialog } from "@/components/add-photo-dialog";
import { Dialog } from "@/components/dialog";
import { LoveLevelPill } from "@/components/love-level-pill";
import { buttonClass, primaryButtonClass, toggleButtonClass } from "@/components/ui";
import { pushUndo } from "@/lib/undo";
import { patchItem, removePhoto, undoWith } from "@/lib/wardrobe-client";
import { type GalleryPhoto, ProductGallery } from "./product-gallery";

/** Stand-in for a sheet without photo (hand-entered, shop blocked): tokens only, same 3:4 frame. */
export function PhotoPlaceholder({ label }: { label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="arch flex aspect-3/4 w-full items-center justify-center border border-line bg-media-backdrop p-space-3 text-center text-sm text-ink-muted"
    >
      <span aria-hidden="true">{label}</span>
    </div>
  );
}

const touch = "min-h-touch-target";

/**
 * Her item's photos in the sheet's gallery (her own first, then the shop's), her level emoji on the big photo (a double
 * tap there opens the 4 levels), and under the thumbnails what she can do with the photo on show: choose it as the
 * thumbnail, remove it (her own only), add one.
 */
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
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ItemPhotoView | null>(null);
  const [picker, setPicker] = useState(false);
  const name = item.name ?? item.product.shop.name;
  const mine = item.photos.filter((photo) => photo.source === "private");
  const shop = item.photos.filter((photo) => photo.source === "shop");
  const photos: GalleryPhoto[] = [
    ...mine.map((photo) => ({ ...photo, group: "private" as const })),
    ...shop.map((photo) => ({ ...photo, group: "shop" as const })),
  ];
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

  const footer = (current: GalleryPhoto | null) => {
    const own = current?.group === "private" ? mine.find((photo) => photo.id === current.id) : undefined;
    return (
      <div className="flex flex-col items-center gap-space-2">
        <div className="flex flex-wrap justify-center gap-space-2">
          {own && (
            <>
              <button
                type="button"
                disabled={busy}
                aria-pressed={item.coverMediaId === own.id}
                onClick={() => cover(item.coverMediaId === own.id ? null : own.id)}
                className={toggleButtonClass}
              >
                {item.coverMediaId === own.id ? t("photos.isCover") : t("photos.cover")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming(own)}
                className={`${buttonClass} ${touch}`}
              >
                {t("photos.remove")}
              </button>
            </>
          )}
          {mine.length < MAX_ITEM_PHOTOS && (
            <button type="button" disabled={busy} onClick={() => setAdding(true)} className={`${buttonClass} ${touch}`}>
              {t("photos.add")}
            </button>
          )}
        </div>
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
    );
  };

  return (
    <section aria-labelledby="photos-title" className="flex flex-col gap-space-3">
      <h2 id="photos-title" className="sr-only">
        {t("photos.title")}
      </h2>
      <ProductGallery
        photos={photos}
        alt={name}
        thumbAlt={(n) => t("photos.alt", { n, name })}
        groupLabels={{ private: t("photos.private"), shop: t("photos.shop") }}
        alwaysThumbs
        overlay={
          <LoveLevelPill item={item} onChange={onChange} reload={reload} open={picker} onOpenChange={setPicker} />
        }
        onDoubleTap={() => setPicker(true)}
        footer={footer}
        empty={<PhotoPlaceholder label={t("photos.empty")} />}
      />

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
    </section>
  );
}
