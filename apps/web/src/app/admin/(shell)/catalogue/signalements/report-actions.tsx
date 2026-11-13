"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { adminRequest, catalogErrorKey } from "@/lib/admin-catalog";
import { trapTab } from "../../../keyboard";
import { buttonClass, primaryButtonClass } from "../../../ui";

/**
 * « Masquer du catalogue » / « Garder »: both close the article's reports; neither touches anyone's wishes. Hiding
 * asks first in an inline confirmation (it can be undone from the article's sheet).
 */
export function ReportActions({ productId }: { productId: string }) {
  const t = useTranslations("Admin.reports");
  const errors = useTranslations("Admin.common.errors");
  const router = useRouter();
  const confirmId = useId();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) confirm.current?.focus();
  }, [confirming]);

  const close = () => {
    setConfirming(false);
    trigger.current?.focus();
  };

  const act = async (action: "hide" | "keep") => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const res = await adminRequest("POST", `/api/admin/products/${productId}/${action}`);
    setBusy(false);
    setConfirming(false);
    if (!res.ok) return setMessage({ text: errors(catalogErrorKey(res.status, res.body)), failed: true });
    setMessage({ text: t(action === "hide" ? "hidden" : "kept"), failed: false });
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-space-2">
      <div className="flex flex-wrap gap-space-3">
        <button
          ref={trigger}
          type="button"
          onClick={() => setConfirming(true)}
          disabled={busy}
          className={`${buttonClass} min-h-touch-target`}
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
      {confirming ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={confirmId}
          className="flex flex-col gap-space-2 rounded-card border border-line bg-surface-sunken p-space-3"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !busy) return close();
            trapTab(e);
          }}
        >
          <p id={confirmId}>{t("hideConfirm")}</p>
          <div className="flex flex-wrap gap-space-2">
            <button
              type="button"
              ref={confirm}
              className={`${primaryButtonClass} min-h-touch-target aria-disabled:opacity-60`}
              aria-disabled={busy}
              onClick={() => void act("hide")}
            >
              {busy ? t("hiding") : t("hide")}
            </button>
            <button
              type="button"
              className={`${buttonClass} min-h-touch-target aria-disabled:opacity-60`}
              aria-disabled={busy}
              onClick={() => !busy && close()}
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : null}
      <p role="status" aria-live="polite" className={message?.failed ? "text-danger" : "text-success"}>
        {message?.text}
      </p>
    </div>
  );
}
