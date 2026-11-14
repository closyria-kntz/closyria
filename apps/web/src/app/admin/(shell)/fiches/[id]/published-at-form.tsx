"use client";

import { ADMIN_PUBLISHED_MIN, type AdminProductDetail, adminProductPublishedAtSchema, isoDay } from "@closyria/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { adminRequest, productErrorKey } from "@/lib/admin-catalog";
import { inputClass, primaryButtonClass } from "../../../ui";

/**
 * « Date de mise en ligne »: a day set by hand (journaled by the API; no import overwrites it), or empty to go back to
 * the automatic date (the shop's at its next import, else unknown).
 */
export function PublishedAtForm({ product }: { product: Pick<AdminProductDetail, "id" | "publishedAt"> }) {
  const t = useTranslations("Admin.products");
  const errors = useTranslations("Admin.common.errors");
  const router = useRouter();
  const hintId = useId();
  const [day, setDay] = useState(product.publishedAt ? product.publishedAt.slice(0, 10) : "");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busyRef.current) return;
    const body = adminProductPublishedAtSchema.safeParse({ publishedAt: day === "" ? null : day });
    if (!body.success) return setMessage({ text: t("publishedInvalid"), failed: true });
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    const res = await adminRequest("PUT", `/api/admin/products/${product.id}/published-at`, body.data);
    busyRef.current = false;
    setBusy(false);
    if (!res.ok) return setMessage({ text: errors(productErrorKey(res.status, res.body)), failed: true });
    setMessage({ text: body.data.publishedAt ? t("publishedSaved") : t("publishedCleared"), failed: false });
    router.refresh();
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
      </div>
      <p id={hintId} className="text-sm text-ink-muted">
        {t("publishedHint")}
      </p>
      <p role="status" aria-live="polite" className={message?.failed ? "text-danger" : "text-success"}>
        {message?.text}
      </p>
    </form>
  );
}
