"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { adminRequest, catalogErrorKey } from "@/lib/admin-catalog";
import { buttonClass } from "../../ui";

/** « Relancer »: a new capture of the same address, then a refresh of the list. */
export function RetryButton({ captureId, label }: { captureId: string; label: string }) {
  const t = useTranslations("Admin.captures");
  const errors = useTranslations("Admin.common.errors");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  const retry = async () => {
    setBusy(true);
    setMessage(null);
    const res = await adminRequest("POST", `/api/admin/captures/${captureId}/retry`);
    setBusy(false);
    if (res.ok) {
      setMessage({ text: t("retried"), failed: false });
      return router.refresh();
    }
    setMessage({ text: errors(catalogErrorKey(res.status, res.body)), failed: true });
  };

  return (
    <div className="flex flex-col gap-space-1">
      <button type="button" className={buttonClass} disabled={busy} onClick={retry} aria-label={label}>
        {busy ? t("retrying") : t("retry")}
      </button>
      <span role="status" aria-live="polite" className={message?.failed ? "text-danger" : "text-success"}>
        {message?.text}
      </span>
    </div>
  );
}
