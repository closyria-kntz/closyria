"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { adminRequest, productErrorKey } from "@/lib/admin-catalog";
import { trapTab } from "../../../keyboard";
import { buttonClass, primaryButtonClass } from "../../../ui";

/**
 * « Supprimer la fiche »: only for a sheet nobody keeps (the API also refuses one kept from a trash). Asks first in
 * an inline confirmation, then goes back to the list.
 */
export function DeleteButton({ productId, keptBy }: { productId: string; keptBy: number }) {
  const t = useTranslations("Admin.products");
  const errors = useTranslations("Admin.common.errors");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) confirm.current?.focus();
  }, [confirming]);

  if (keptBy > 0) return <p className="text-sm text-ink-muted">{t("deleteKept")}</p>;

  const close = () => {
    setConfirming(false);
    trigger.current?.focus();
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const res = await adminRequest("DELETE", `/api/admin/products/${productId}`);
    if (res.ok) {
      router.push("/admin/fiches");
      return router.refresh();
    }
    setBusy(false);
    close();
    setMessage(errors(productErrorKey(res.status, res.body)));
  };

  return (
    <div className="flex flex-col gap-space-2">
      <button ref={trigger} type="button" className={buttonClass} onClick={() => setConfirming(true)}>
        {t("delete")}
      </button>
      {confirming ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-confirm"
          className="flex flex-col gap-space-2 rounded-card border border-line bg-surface-sunken p-space-3"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !busy) return close();
            trapTab(e);
          }}
        >
          <p id="delete-confirm">{t("deleteConfirm")}</p>
          <div className="flex flex-wrap gap-space-2">
            <button
              type="button"
              ref={confirm}
              className={`${primaryButtonClass} aria-disabled:opacity-60`}
              aria-disabled={busy}
              onClick={remove}
            >
              {busy ? t("deleting") : t("delete")}
            </button>
            <button
              type="button"
              className={`${buttonClass} aria-disabled:opacity-60`}
              aria-disabled={busy}
              onClick={() => !busy && close()}
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : null}
      <span role="status" aria-live="polite" className="text-danger">
        {message}
      </span>
    </div>
  );
}
