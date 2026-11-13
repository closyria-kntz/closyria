"use client";

import type { ShopStatus } from "@closyria/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { adminRequest, catalogErrorKey } from "@/lib/admin-catalog";
import { buttonClass, primaryButtonClass } from "../../../ui";

/** « Valider » / « Refuser »: a shop found through a link enters the catalogue only once an admin validates it. */
export function ShopReview({
  shopId,
  status,
  isMajorBrand,
}: {
  shopId: string;
  status: ShopStatus;
  /** « Grande enseigne »: published, its articles still never show in « Découvrir ». */
  isMajorBrand: boolean;
}) {
  const t = useTranslations("Admin.shops.review");
  const errors = useTranslations("Admin.common.errors");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  const act = async (action: "publish" | "refuse") => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const res = await adminRequest("POST", `/api/admin/shops/${shopId}/${action}`);
    setBusy(false);
    if (!res.ok) return setMessage({ text: errors(catalogErrorKey(res.status, res.body)), failed: true });
    setMessage({ text: t(action === "publish" ? "publishedDone" : "refusedDone"), failed: false });
    router.refresh();
  };

  return (
    <section aria-labelledby="review-title" className="flex flex-col gap-space-3">
      <h2 id="review-title" className="font-display text-lead font-strong">
        {t("title")}
      </h2>
      <p className="text-ink-muted">{status === "published" && isMajorBrand ? t("publishedMajorBrand") : t(status)}</p>
      <div className="flex flex-wrap gap-space-3">
        {status !== "published" && (
          <button
            type="button"
            onClick={() => void act("publish")}
            disabled={busy}
            className={`${primaryButtonClass} min-h-touch-target`}
          >
            {t("publish")}
          </button>
        )}
        {status !== "refused" && (
          <button
            type="button"
            onClick={() => void act("refuse")}
            disabled={busy}
            className={`${buttonClass} min-h-touch-target`}
          >
            {t("refuse")}
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className={message?.failed ? "text-danger" : "text-success"}>
        {message?.text}
      </p>
    </section>
  );
}
