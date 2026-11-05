"use client";

import { adminMergedSchema } from "@closyria/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { adminRequest, catalogErrorKey } from "@/lib/admin-catalog";
import { buttonClass, inputClass, primaryButtonClass } from "../../ui";

type Option = { id: string; name: string };

/** "Fusionner dans…": pick the shop to keep, confirm naming both shops, then go to the kept shop. */
export function MergeDialog({ source, options }: { source: Option; options: Option[] }) {
  const t = useTranslations("Admin.shops.merge");
  const errors = useTranslations("Admin.common.errors");
  const router = useRouter();
  const [targetId, setTargetId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const target = options.find((o) => o.id === targetId);

  // Focus moves into the confirmation when it opens, and back to « Fusionner » when it closes.
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const cancel = () => {
    if (busy) return;
    setConfirming(false);
    startRef.current?.focus();
  };

  const merge = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await adminRequest("POST", `/api/admin/shops/${source.id}/merge`, { targetId });
    setBusy(false);
    const merged = adminMergedSchema.safeParse(res.body);
    if (!res.ok || !merged.success) {
      setConfirming(false);
      startRef.current?.focus();
      return setError(errors(catalogErrorKey(res.status, res.body)));
    }
    router.push(`/admin/boutiques/${merged.data.targetId}`);
    router.refresh();
  };

  return (
    <section aria-labelledby="merge-title" className="flex flex-col gap-space-3">
      <h2 id="merge-title" className="font-display text-lead font-strong">
        {t("title")}
      </h2>
      <p className="text-ink-muted">{t("intro")}</p>
      {options.length === 0 ? (
        <p>{t("none")}</p>
      ) : (
        <div className="flex flex-col gap-space-2 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-space-1 text-sm">
            {t("target")}
            <select
              value={targetId}
              onChange={(e) => {
                setTargetId(e.target.value);
                setConfirming(false);
              }}
              className={inputClass}
            >
              <option value="">{t("choose")}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <button
            ref={startRef}
            type="button"
            className={buttonClass}
            disabled={!target}
            onClick={() => setConfirming(true)}
          >
            {t("start")}
          </button>
        </div>
      )}
      {confirming && target ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="merge-confirm-title"
          aria-describedby="merge-confirm-text"
          onKeyDown={(e) => {
            if (e.key === "Escape") return cancel();
            if (e.key !== "Tab") return;
            // aria-modal: keep Tab and Shift+Tab on the dialog's enabled buttons.
            const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (!first || !last) return e.preventDefault();
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }}
          className="flex flex-col gap-space-3 rounded-card border border-line bg-surface-sunken p-space-4"
        >
          <p id="merge-confirm-title" className="font-strong">
            {t("title")}
          </p>
          <p id="merge-confirm-text">{t("confirm", { source: source.name, target: target.name })}</p>
          <div className="flex flex-wrap gap-space-2">
            <button
              ref={confirmRef}
              type="button"
              className={`${primaryButtonClass} aria-disabled:opacity-60`}
              aria-disabled={busy}
              onClick={merge}
            >
              {t("confirmButton")}
            </button>
            <button
              type="button"
              className={`${buttonClass} aria-disabled:opacity-60`}
              aria-disabled={busy}
              onClick={cancel}
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
