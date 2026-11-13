"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { adminRequest, catalogErrorKey } from "@/lib/admin-catalog";
import { buttonClass } from "../../../ui";

/**
 * « Masqué de Découvrir le … » with « Remettre dans le catalogue », which undoes « Masquer du catalogue » (journaled
 * by the API). Always mounted, so its confirmation stays once the refreshed sheet is no longer hidden.
 */
export function UnhideButton({ productId, hiddenLine }: { productId: string; hiddenLine: string | null }) {
  const t = useTranslations("Admin.products");
  const errors = useTranslations("Admin.common.errors");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  const unhide = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const res = await adminRequest("POST", `/api/admin/products/${productId}/unhide`);
    setBusy(false);
    if (!res.ok) return setMessage({ text: errors(catalogErrorKey(res.status, res.body)), failed: true });
    setMessage({ text: t("unhidden"), failed: false });
    router.refresh();
  };

  if (!hiddenLine && !message) return null;
  return (
    <div className="flex flex-col gap-space-2 rounded-card border border-line bg-surface-sunken p-space-3">
      {hiddenLine ? (
        <div className="flex flex-wrap items-center gap-space-3">
          <p>{hiddenLine}</p>
          <button
            type="button"
            onClick={() => void unhide()}
            aria-disabled={busy}
            className={`${buttonClass} min-h-touch-target aria-disabled:opacity-60`}
          >
            {busy ? t("unhiding") : t("unhide")}
          </button>
        </div>
      ) : null}
      <p role="status" aria-live="polite" className={message?.failed ? "text-danger" : "text-success"}>
        {message?.text}
      </p>
    </div>
  );
}
