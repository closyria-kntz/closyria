"use client";

import { type ItemPhotoView, type ItemView, MAX_ITEM_PHOTOS } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Dialog } from "@/components/dialog";
import { buttonClass, primaryButtonClass } from "@/components/ui";
import { requestAccountPrompt } from "@/lib/account-prompt-request";
import { checkPhoto } from "@/lib/photo-check";
import { pushUndo } from "@/lib/undo";
import { patchItem, removePhoto, undoWith, uploadPhoto } from "@/lib/wardrobe-client";

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

function Frame({ photo, alt }: { photo: ItemPhotoView; alt: string }) {
  return (
    // The whole photo in a 3:4 frame on the media backdrop, never cropped (visual direction §6).
    <div className="aspect-3/4 overflow-hidden rounded-card bg-media-backdrop">
      {/* biome-ignore lint/performance/noImgElement: photos come from our own API, sized by it. */}
      <img
        src={photo.url}
        width={photo.width}
        height={photo.height}
        alt={alt}
        loading="lazy"
        className="size-full object-contain"
      />
    </div>
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
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ItemPhotoView | null>(null);
  const name = item.name ?? item.product.shop.name;
  const mine = item.photos.filter((photo) => photo.source === "private");
  const shop = item.photos.filter((photo) => photo.source === "shop");
  const fail = (code: string) => setError(t(`errors.${code}` as "errors.failed"));

  async function add(file: File) {
    setError(null);
    const refused = checkPhoto(file);
    if (refused) return fail(refused);
    setBusy(true);
    const result = await uploadPhoto(item.id, file);
    if (result.ok) {
      onChange(result.item);
      pushUndo(t("toast.photoAdded"), null);
      void requestAccountPrompt("photo");
    } else fail(result.error);
    setBusy(false);
  }

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
              <Frame photo={photo} alt={t("photos.alt", { n: index + 1, name })} />
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
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          className="hidden"
          aria-label={t("photos.add")}
          data-testid="photo-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void add(file);
          }}
        />
        <button
          type="button"
          disabled={busy || mine.length >= MAX_ITEM_PHOTOS}
          onClick={() => input.current?.click()}
          className={`${buttonClass} ${touch}`}
        >
          {t("photos.add")}
        </button>
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
              <Frame photo={photo} alt={t("photos.alt", { n: index + 1, name })} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
