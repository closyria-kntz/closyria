"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { inputClass, primaryButtonClass } from "@/components/ui";
import { createCapture } from "@/lib/catalog-client";

type ErrorKey = "invalidUrl" | "rateLimited" | "failed";

const isHttpUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * « Coller un lien » → « Ajouter »: starts the capture, then opens the product page, which follows it.
 * With `autoSubmit` (the Android share target) the link it is given is added at once.
 */
export function CaptureForm({ initialUrl = "", autoSubmit = false }: { initialUrl?: string; autoSubmit?: boolean }) {
  const t = useTranslations("Capture");
  const router = useRouter();
  const ids = { field: useId(), hint: useId(), error: useId() };
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(autoSubmit);
  const [error, setError] = useState<ErrorKey | null>(null);
  const started = useRef(false);

  const submit = async (value: string) => {
    const link = value.trim();
    if (!isHttpUrl(link)) return setError("invalidUrl");
    setBusy(true);
    setError(null);
    const result = await createCapture(link);
    if (!result.ok) {
      setBusy(false);
      return setError(
        result.error === "failed" ? "failed" : result.error === "rate_limited" ? "rateLimited" : "invalidUrl",
      );
    }
    const target = `/produits/${result.productId}?capture=${result.captureId}`;
    if (autoSubmit) router.replace(target);
    else router.push(target);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on arrival; `started` also guards React's double effect.
  useEffect(() => {
    if (!autoSubmit || started.current) return;
    started.current = true;
    void submit(initialUrl);
  }, []);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(url);
  };

  return (
    <form noValidate onSubmit={onSubmit} className="flex w-full flex-col gap-space-3 text-left">
      <label htmlFor={ids.field} className="font-strong">
        {t("field")}
      </label>
      <input
        id={ids.field}
        name="url"
        type="url"
        inputMode="url"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder={t("placeholder")}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        aria-invalid={error === "invalidUrl" || undefined}
        aria-describedby={error ? `${ids.hint} ${ids.error}` : ids.hint}
        className={inputClass}
      />
      <p id={ids.hint} className="text-sm text-ink-muted">
        {t("hint")}
      </p>
      <div aria-live="polite">
        {error && (
          <p id={ids.error} role="alert" className="text-danger">
            {t(`errors.${error}`)}
          </p>
        )}
        {busy && autoSubmit && !error && <p role="status">{t("share.adding")}</p>}
      </div>
      <button type="submit" className={primaryButtonClass} disabled={busy}>
        {busy ? t("busy") : t("submit")}
      </button>
    </form>
  );
}
