"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { adminRequest, catalogErrorKey } from "@/lib/admin-catalog";
import { buttonClass, primaryButtonClass } from "../../../ui";

/** « Masquer du catalogue » / « Garder »: both close the article's reports; neither touches anyone's wishes. */
export function ReportActions({ productId }: { productId: string }) {
  const t = useTranslations("Admin.reports");
  const errors = useTranslations("Admin.common.errors");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  const act = async (action: "hide" | "keep") => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const res = await adminRequest("POST", `/api/admin/products/${productId}/${action}`);
    setBusy(false);
    if (!res.ok) return setMessage({ text: errors(catalogErrorKey(res.status, res.body)), failed: true });
    setMessage({ text: t(action === "hide" ? "hidden" : "kept"), failed: false });
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-space-2">
      <div className="flex flex-wrap gap-space-3">
        <button
          type="button"
          onClick={() => void act("hide")}
          disabled={busy}
          className={`${primaryButtonClass} min-h-touch-target`}
        >
          {t("hide")}
        </button>
        <button
          type="button"
          onClick={() => void act("keep")}
          disabled={busy}
          className={`${buttonClass} min-h-touch-target`}
        >
          {t("keep")}
        </button>
      </div>
      <p role="status" aria-live="polite" className={message?.failed ? "text-danger" : "text-success"}>
        {message?.text}
      </p>
    </div>
  );
}
