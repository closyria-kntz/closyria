"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { adminRequest, productErrorKey } from "@/lib/admin-catalog";
import { buttonClass } from "../../../ui";

/** « Relancer la lecture »: queues a new capture of the sheet's address. */
export function RecaptureButton({ productId }: { productId: string }) {
  const t = useTranslations("Admin.products");
  const errors = useTranslations("Admin.common.errors");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  const recapture = async () => {
    setBusy(true);
    setMessage(null);
    const res = await adminRequest("POST", `/api/admin/products/${productId}/recapture`);
    setBusy(false);
    if (res.ok) {
      setMessage({ text: t("recaptured"), failed: false });
      return router.refresh();
    }
    setMessage({ text: errors(productErrorKey(res.status, res.body)), failed: true });
  };

  return (
    <div className="flex flex-col gap-space-1">
      <button type="button" className={buttonClass} disabled={busy} onClick={recapture}>
        {busy ? t("recapturing") : t("recapture")}
      </button>
      <span role="status" aria-live="polite" className={message?.failed ? "text-danger" : "text-success"}>
        {message?.text}
      </span>
    </div>
  );
}
