"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { adminRequest } from "@/lib/admin-catalog";
import { capInputOf, parseEuroCap } from "@/lib/admin-order-emails";
import { inputClass, primaryButtonClass } from "../../ui";

/** « Plafond du mois »: the AI's monthly cap in euros (0 turns the AI off), saved at once for the next call. */
export function AiCapForm({ capCents }: { capCents: number }) {
  const t = useTranslations("Admin.orderEmails");
  const router = useRouter();
  const [value, setValue] = useState(capInputOf(capCents));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  useEffect(() => setValue(capInputOf(capCents)), [capCents]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    const cents = parseEuroCap(value);
    if (cents === null) return setMessage({ text: t("capInvalid"), failed: true });
    setBusy(true);
    const res = await adminRequest("PUT", "/api/admin/settings/ai-cap", { capCents: cents });
    setBusy(false);
    if (!res.ok) return setMessage({ text: t("capFailed"), failed: true });
    setMessage({ text: t("capSaved"), failed: false });
    router.refresh();
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-space-2">
      <div className="flex flex-wrap items-end gap-space-3">
        <label className="flex flex-col gap-space-1 text-sm">
          {t("cap")}
          <input
            inputMode="decimal"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-describedby="ai-cap-hint"
            data-testid="ai-cap"
            className={inputClass}
          />
        </label>
        <button type="submit" className={primaryButtonClass} disabled={busy}>
          {t("capSave")}
        </button>
      </div>
      <span id="ai-cap-hint" className="text-sm text-ink-muted">
        {t("capHint")}
      </span>
      <p role="status" aria-live="polite" className={message?.failed ? "text-danger" : "text-success"}>
        {message?.text}
      </p>
    </form>
  );
}
