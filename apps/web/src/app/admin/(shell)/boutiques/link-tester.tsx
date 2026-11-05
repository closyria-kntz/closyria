"use client";

import { adminCaptureAcceptedSchema } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { adminRequest, catalogErrorKey } from "@/lib/admin-catalog";
import { inputClass, primaryButtonClass } from "../../ui";
import { CaptureOutcome } from "./capture-outcome";
import { useCaptureFollow } from "./use-capture-follow";

/** "Tester un lien": an admin_test capture, followed until it finishes. Creates no product. */
export function LinkTester({ initialUrl }: { initialUrl?: string | null }) {
  const t = useTranslations("Admin.shops.tester");
  const errors = useTranslations("Admin.common.errors");
  const [url, setUrl] = useState(initialUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const { state, follow, reset } = useCaptureFollow();
  const busy = state.phase === "running";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    reset();
    const res = await adminRequest("POST", "/api/admin/captures/test", { url });
    const accepted = adminCaptureAcceptedSchema.safeParse(res.body);
    if (!res.ok || !accepted.success) return setError(errors(catalogErrorKey(res.status, res.body)));
    follow(accepted.data.captureId);
  };

  return (
    <section aria-labelledby="tester-title" className="flex flex-col gap-space-3">
      <h2 id="tester-title" className="font-display text-lead font-strong">
        {t("title")}
      </h2>
      <p className="text-ink-muted">{t("intro")}</p>
      <form onSubmit={submit} className="flex flex-col gap-space-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-space-1 text-sm">
          {t("url")}
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className={inputClass}
            autoComplete="off"
          />
        </label>
        <button type="submit" className={primaryButtonClass} disabled={busy}>
          {t("run")}
        </button>
      </form>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      <CaptureOutcome state={state} />
    </section>
  );
}
