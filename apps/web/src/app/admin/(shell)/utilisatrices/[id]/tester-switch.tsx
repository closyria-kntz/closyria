"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { adminRequest } from "@/lib/admin-catalog";

/**
 * « Testeuse » (catalogue conforme, 2026-11-14): a checkbox saved at once (`PATCH /api/admin/users/{id}`, journalised).
 * On, she sees in « Découvrir » what only a full import brought, with the shops' photos and texts.
 */
export function TesterSwitch({ userId, isTester }: { userId: string; isTester: boolean }) {
  const t = useTranslations("Admin.users");
  const router = useRouter();
  const hintId = useId();
  const [checked, setChecked] = useState(isTester);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  const change = async (next: boolean) => {
    setBusy(true);
    setMessage(null);
    setChecked(next);
    const res = await adminRequest("PATCH", `/api/admin/users/${encodeURIComponent(userId)}`, { isTester: next });
    setBusy(false);
    if (res.ok) {
      setMessage({ text: t("testerSaved"), failed: false });
      return router.refresh();
    }
    setChecked(!next);
    setMessage({ text: t("testerFailed"), failed: true });
  };

  return (
    <div className="flex flex-col gap-space-2">
      <label className="flex min-h-touch-target items-start gap-space-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          disabled={busy}
          onChange={(e) => void change(e.target.checked)}
          aria-describedby={hintId}
          data-testid="tester-switch"
          className="mt-space-0-5 size-space-5 accent-accent"
        />
        <span className="flex flex-col gap-space-1">
          <span className="font-strong">{t("tester")}</span>
          <span id={hintId} className="text-ink-muted">
            {t("testerHint")}
          </span>
        </span>
      </label>
      <p role="status" aria-live="polite" className={`text-sm ${message?.failed ? "text-danger" : "text-success"}`}>
        {message?.text}
      </p>
    </div>
  );
}
