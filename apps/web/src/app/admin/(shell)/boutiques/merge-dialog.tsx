"use client";

import { adminMergedSchema } from "@closyria/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
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
  const target = options.find((o) => o.id === targetId);

  const merge = async () => {
    setBusy(true);
    setError(null);
    const res = await adminRequest("POST", `/api/admin/shops/${source.id}/merge`, { targetId });
    setBusy(false);
    const merged = adminMergedSchema.safeParse(res.body);
    if (!res.ok || !merged.success) {
      setConfirming(false);
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
          <button type="button" className={buttonClass} disabled={!target} onClick={() => setConfirming(true)}>
            {t("start")}
          </button>
        </div>
      )}
      {confirming && target ? (
        <div
          role="alertdialog"
          aria-label={t("title")}
          className="flex flex-col gap-space-3 rounded-card border border-line bg-surface-sunken p-space-4"
        >
          <p>{t("confirm", { source: source.name, target: target.name })}</p>
          <div className="flex flex-wrap gap-space-2">
            <button type="button" className={primaryButtonClass} disabled={busy} onClick={merge}>
              {t("confirmButton")}
            </button>
            <button type="button" className={buttonClass} disabled={busy} onClick={() => setConfirming(false)}>
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
