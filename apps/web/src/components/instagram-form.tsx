"use client";

import {
  bareItemHref,
  isInstagramUrl,
  MAX_ITEM_BRAND,
  MAX_ITEM_NAME,
  MAX_NOTES,
  MAX_SIZE_LABEL,
} from "@closyria/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";
import { createInstagramItem } from "@/lib/orders-client";
import { parsePriceCents } from "@/lib/price";
import { useCurrentProfile } from "@/lib/profile-context";
import { pushUndo } from "@/lib/undo";
import { undoWith, uploadPhoto } from "@/lib/wardrobe-client";
import { focusRing, inputClass, primaryButtonClass, textareaClass, toggleButtonClass } from "./ui";

type Action = "wish" | "ordered";

/**
 * The short form of an Instagram link (spec §3.6, C5): Instagram is never read, she says what she saw — its name, the
 * shop or brand, her size, a photo from her gallery, and whether she wants it or ordered it (with what she paid). The
 * link stays as the article's source; the article has no product, its sheet opens once added.
 */
export function InstagramForm() {
  const t = useTranslations("Orders.instagram");
  const tToast = useTranslations("Item.toast");
  const router = useRouter();
  const link = useSearchParams().get("lien") ?? "";
  const profile = useCurrentProfile();
  const ids = {
    name: useId(),
    brand: useId(),
    size: useId(),
    price: useId(),
    photo: useId(),
    notes: useId(),
    choice: useId(),
    error: useId(),
  };
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [size, setSize] = useState("");
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [action, setAction] = useState<Action>("wish");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const header = (
    <div className="flex flex-col gap-space-2">
      <h1 className="font-title text-page-title leading-none font-regular">{t("title")}</h1>
      <p className="text-ink-muted">{t("intro")}</p>
    </div>
  );

  if (!isInstagramUrl(link)) {
    return (
      <div className="flex max-w-measure flex-col gap-space-4">
        {header}
        <p role="alert">{t("badLink")}</p>
        <Link href="/" className={`${primaryButtonClass} min-h-touch-target self-start`}>
          {t("home")}
        </Link>
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError(t("errors.name"));
    const paid = action === "ordered" ? parsePriceCents(price) : { ok: true as const, cents: undefined };
    if (!paid.ok) return setError(t("errors.price"));
    setBusy(true);
    setError(null);
    const result = await createInstagramItem({
      url: link,
      action,
      ...(profile.id ? { profileId: profile.id } : {}),
      name: name.trim(),
      brand: brand.trim() || null,
      sizeLabel: size.trim() || null,
      notes: notes.trim() || null,
      ...(action === "ordered" ? { priceCents: paid.cents ?? null } : {}),
    });
    if (!result.ok) {
      setBusy(false);
      return setError(t(result.error === "rate_limited" ? "errors.rate_limited" : "errors.failed"));
    }
    const id = result.item.id;
    pushUndo(
      tToast(action === "ordered" ? "ordered" : "wish"),
      undoWith(result.undo, async () => router.push("/articles")),
    );
    if (photo && !(await uploadPhoto(id, photo)).ok) pushUndo(t("errors.photo"), null);
    router.push(bareItemHref(id));
  };

  const choice = (value: Action, label: string) => (
    <label
      className={`${toggleButtonClass} relative cursor-pointer justify-center has-checked:border-accent has-checked:bg-hint has-checked:font-strong has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring has-focus-visible:outline-solid`}
    >
      <input
        type="radio"
        name={ids.choice}
        value={value}
        checked={action === value}
        onChange={() => setAction(value)}
        className="absolute inset-space-0 cursor-pointer opacity-0"
      />
      {label}
    </label>
  );

  return (
    <div className="flex max-w-measure flex-col gap-space-5 pb-space-6">
      {header}
      <form noValidate onSubmit={submit} aria-busy={busy || undefined} className="flex flex-col gap-space-4">
        <fieldset className="flex flex-col gap-space-2">
          <legend className="pb-space-2 text-sm font-strong">{t("choice")}</legend>
          <div className="grid grid-cols-2 gap-space-2">
            {choice("wish", t("wish"))}
            {choice("ordered", t("ordered"))}
          </div>
        </fieldset>
        <span className="flex flex-col gap-space-1">
          <label htmlFor={ids.name} className="text-sm font-strong">
            {t("name")}
          </label>
          <input
            id={ids.name}
            value={name}
            maxLength={MAX_ITEM_NAME}
            required
            aria-invalid={error === t("errors.name") || undefined}
            onChange={(e) => setName(e.target.value)}
            className={`${inputClass} min-h-touch-target`}
          />
        </span>
        <span className="flex flex-col gap-space-1">
          <label htmlFor={ids.brand} className="text-sm font-strong">
            {t("brand")}
          </label>
          <input
            id={ids.brand}
            value={brand}
            maxLength={MAX_ITEM_BRAND}
            onChange={(e) => setBrand(e.target.value)}
            className={`${inputClass} min-h-touch-target`}
          />
        </span>
        <div className="grid grid-cols-2 gap-space-2">
          <span className="flex flex-col gap-space-1">
            <label htmlFor={ids.size} className="text-sm font-strong">
              {t("size")}
            </label>
            <input
              id={ids.size}
              value={size}
              maxLength={MAX_SIZE_LABEL}
              onChange={(e) => setSize(e.target.value)}
              className={`${inputClass} min-h-touch-target`}
            />
          </span>
          {action === "ordered" && (
            <span className="flex flex-col gap-space-1">
              <label htmlFor={ids.price} className="text-sm font-strong">
                {t("price")}
              </label>
              <input
                id={ids.price}
                value={price}
                inputMode="decimal"
                onChange={(e) => setPrice(e.target.value)}
                className={`${inputClass} min-h-touch-target`}
              />
            </span>
          )}
        </div>
        <span className="flex flex-col gap-space-1">
          <label htmlFor={ids.photo} className="text-sm font-strong">
            {t("photo")}
          </label>
          <input
            id={ids.photo}
            type="file"
            accept="image/*"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            className={`min-h-touch-target rounded-button text-sm file:mr-space-3 file:min-h-touch-target file:rounded-button file:border file:border-line file:bg-surface-raised file:px-space-3 file:text-ink ${focusRing}`}
          />
        </span>
        <span className="flex flex-col gap-space-1">
          <label htmlFor={ids.notes} className="text-sm font-strong">
            {t("notes")}
          </label>
          <textarea
            id={ids.notes}
            value={notes}
            maxLength={MAX_NOTES}
            rows={3}
            onChange={(e) => setNotes(e.target.value)}
            className={textareaClass}
          />
        </span>
        {error && (
          <p id={ids.error} role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className={`${primaryButtonClass} min-h-touch-target self-start`}>
          {busy ? t("busy") : t("save")}
        </button>
      </form>
    </div>
  );
}
