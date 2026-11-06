"use client";

import type { ItemView } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { type DragEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { requestAccountPrompt } from "@/lib/account-prompt-request";
import { pollUntil } from "@/lib/capture-poll";
import { checkPhoto } from "@/lib/photo-check";
import { asHttpUrl, photoSource } from "@/lib/photo-source";
import { pushUndo } from "@/lib/undo";
import { fetchPhotoImport, importPhoto, uploadPhoto } from "@/lib/wardrobe-client";
import { Dialog } from "./dialog";
import { buttonClass, inputClass, primaryButtonClass } from "./ui";

const touch = "min-h-touch-target";

/** The message key (`Item.errors.*`) for what went wrong: an upload or API code, or the reason an import failed. */
function errorKey(code: string): string {
  switch (code) {
    case "blocked":
    case "timeout":
    case "unsupported":
      return `import_${code}`;
    case "too_large":
      return "image_too_large";
    default:
      return code;
  }
}

/** « Ajouter une photo »: paste, drop, pick a file, take one (touch screens) or give a link. */
export function AddPhotoDialog({
  open,
  onClose,
  itemId,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  itemId: string;
  onChange: (item: ItemView) => void;
}) {
  const t = useTranslations("Item");
  return (
    <Dialog open={open} onClose={onClose} title={t("photos.addTitle")} closeLabel={t("photos.close")}>
      <AddPhotoBody itemId={itemId} onChange={onChange} onClose={onClose} />
    </Dialog>
  );
}

/**
 * Mounted only while the window is open: its state starts afresh each time, and leaving stops an import's polling
 * (silently: the import goes on, and the next read of the item attaches its photo).
 */
function AddPhotoBody({
  itemId,
  onChange,
  onClose,
}: {
  itemId: string;
  onChange: (item: ItemView) => void;
  onClose: () => void;
}) {
  const t = useTranslations("Item");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The poll gave up but the worker may still finish: the next read of the item attaches the photo.
  const [arriving, setArriving] = useState(false);
  const [link, setLink] = useState("");
  const [dragging, setDragging] = useState(false);
  const [coarse, setCoarse] = useState(false);
  const stopPolling = useRef<(() => void) | null>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCoarse(window.matchMedia("(pointer: coarse)").matches);
    return () => stopPolling.current?.();
  }, []);

  const fail = (code: string) => {
    setArriving(false);
    setError(t(`errors.${errorKey(code)}` as "errors.failed"));
    setBusy(false);
  };
  const done = (item: ItemView) => {
    onChange(item);
    pushUndo(t("toast.photoAdded"), null);
    void requestAccountPrompt("photo");
    onClose();
  };

  async function addFile(file: File) {
    setError(null);
    setArriving(false);
    const refused = checkPhoto(file);
    if (refused) return fail(refused);
    setBusy(true);
    const result = await uploadPhoto(itemId, file);
    if (result.ok) done(result.item);
    else fail(result.error);
  }

  async function addLink(url: string) {
    setError(null);
    setArriving(false);
    setBusy(true);
    const started = await importPhoto(itemId, url);
    if (!started.ok) return fail(started.error);
    stopPolling.current = pollUntil(
      (signal) => fetchPhotoImport(itemId, started.importId, undefined, signal),
      (view) => view.status !== "queued",
      {
        onUpdate: (view) => {
          if (view.status === "attached") done(view.item);
          else if (view.status === "failed") fail(view.error);
        },
        // Not a failure: the import may still finish, and reading the item then attaches it (server side).
        onGiveUp: () => {
          setBusy(false);
          setArriving(true);
        },
      },
    );
  }

  function handle(data: DataTransfer | null) {
    if (busy) return;
    const source = photoSource(data);
    if (source.kind === "file") void addFile(source.file);
    else if (source.kind === "url") void addLink(source.url);
    else fail("not_a_photo");
  }

  // Paste works wherever the focus is (right after opening it is on « Fermer », outside the body): listen on the
  // document while the window is open. The latest `handle` is kept in a ref so the listener is added only once.
  const latest = useRef(handle);
  latest.current = handle;
  useEffect(() => {
    function onPaste(event: globalThis.ClipboardEvent) {
      // Text pasted into the link field is just typing there; anything else is a photo to add.
      if (event.target === linkInput.current && photoSource(event.clipboardData).kind !== "file") return;
      event.preventDefault();
      latest.current(event.clipboardData);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    handle(event.dataTransfer);
  }

  function submitLink(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const url = asHttpUrl(link);
    if (url) void addLink(url);
    else fail("not_a_photo");
  }

  const picked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void addFile(file);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: paste and drop are shortcuts on top of the buttons and the link field below.
    <div
      className="flex flex-col gap-space-4"
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={() => setDragging(true)}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDragging(false)}
      onDrop={onDrop}
    >
      <div
        data-testid="photo-drop-zone"
        className={`rounded-card border border-line border-dashed p-space-4 text-center text-sm text-ink-muted ${dragging ? "bg-surface-strong" : ""}`}
      >
        {t("photos.dropZone")}
      </div>

      <div className="flex flex-wrap gap-space-2">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="photo-input"
          onChange={picked}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          className={`${buttonClass} ${touch}`}
        >
          {t("photos.chooseFile")}
        </button>
        {coarse && (
          <>
            <input
              ref={cameraInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
              data-testid="photo-camera"
              onChange={picked}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => cameraInput.current?.click()}
              className={`${buttonClass} ${touch}`}
            >
              {t("photos.takePhoto")}
            </button>
          </>
        )}
      </div>

      <form onSubmit={submitLink} className="flex flex-col gap-space-2">
        <label htmlFor="photo-link" className="text-sm font-strong">
          {t("photos.linkLabel")}
        </label>
        <div className="flex flex-wrap gap-space-2">
          <input
            ref={linkInput}
            id="photo-link"
            type="text"
            inputMode="url"
            autoComplete="off"
            value={link}
            disabled={busy}
            onChange={(event) => setLink(event.target.value)}
            className={`${inputClass} ${touch} min-w-0 flex-1 basis-0`}
          />
          <button type="submit" disabled={busy || link.trim() === ""} className={`${primaryButtonClass} ${touch}`}>
            {t("photos.linkSubmit")}
          </button>
        </div>
      </form>

      {(busy || arriving) && (
        <p role="status" className="text-sm text-ink-muted">
          {busy ? t("photos.adding") : t("photos.arriving")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
