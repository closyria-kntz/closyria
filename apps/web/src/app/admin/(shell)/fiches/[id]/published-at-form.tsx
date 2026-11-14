"use client";

import { ADMIN_PUBLISHED_MIN, type AdminProductDetail, type AdminProductPublishedAt, isoDay } from "@closyria/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { adminRequest, productErrorKey } from "@/lib/admin-catalog";
import { publishedAtSave, publishedDay } from "@/lib/published-at";
import { buttonClass, inputClass, primaryButtonClass } from "../../../ui";

/**
 * « Date de mise en ligne »: a day set by hand (journaled by the API; no import overwrites it). A date set by hand
 * offers « Revenir à la date automatique » (the shop's at its next import, else unknown). Saving the day shown,
 * unchanged, sends nothing: an automatic date never becomes the admin's by itself. After a save the field shows the
 * reloaded sheet's date.
 */
export function PublishedAtForm({
  product,
}: {
  product: Pick<AdminProductDetail, "id" | "publishedAt" | "publishedSource">;
}) {
  const t = useTranslations("Admin.products");
  const errors = useTranslations("Admin.common.errors");
  const router = useRouter();
  const hintId = useId();
  const [day, setDay] = useState(publishedDay(product));
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  // The reloaded sheet (after a save, or any refresh) sets the field again.
  const { publishedAt, publishedSource } = product;
  useEffect(() => {
    setDay(publishedDay({ publishedAt, publishedSource }));
  }, [publishedAt, publishedSource]);

  const send = async (body: AdminProductPublishedAt) => {
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    const res = await adminRequest("PUT", `/api/admin/products/${product.id}/published-at`, body);
    busyRef.current = false;
    setBusy(false);
    if (!res.ok) return setMessage({ text: errors(productErrorKey(res.status, res.body)), failed: true });
    setMessage({ text: body.publishedAt ? t("publishedSaved") : t("publishedCleared"), failed: false });
    router.refresh();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busyRef.current) return;
    const save = publishedAtSave(day, product);
    if (save.kind === "unchanged") return setMessage({ text: t("publishedUnchanged"), failed: false });
    if (save.kind === "invalid") return setMessage({ text: t("publishedInvalid"), failed: true });
    await send(save.body);
  };

  const backToAuto = async () => {
    if (busyRef.current) return;
    await send({ publishedAt: null });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-space-2">
      <div className="flex flex-wrap items-end gap-space-3">
        <label className="flex flex-col gap-space-1 text-sm">
          {t("publishedField")}
          <input
            type="date"
            value={day}
            min={ADMIN_PUBLISHED_MIN}
            max={isoDay(new Date(), 1)}
            onChange={(e) => setDay(e.target.value)}
            aria-describedby={hintId}
            className={inputClass}
          />
        </label>
        <button type="submit" className={`${primaryButtonClass} aria-disabled:opacity-60`} aria-disabled={busy}>
          {busy ? t("publishedSaving") : t("publishedSave")}
        </button>
        {product.publishedSource === "admin" ? (
          <button
            type="button"
            onClick={() => void backToAuto()}
            className={`${buttonClass} aria-disabled:opacity-60`}
            aria-disabled={busy}
          >
            {t("publishedBackToAuto")}
          </button>
        ) : null}
      </div>
      <p id={hintId} className="text-sm text-ink-muted">
        {product.publishedSource === "admin" ? t("publishedHintAdmin") : t("publishedHint")}
      </p>
      <p role="status" aria-live="polite" className={message?.failed ? "text-danger" : "text-success"}>
        {message?.text}
      </p>
    </form>
  );
}
