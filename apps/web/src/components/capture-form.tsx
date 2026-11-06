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
export function CaptureForm({
  initialUrl = "",
  autoSubmit = false,
  fieldId,
  compact = false,
}: {
  initialUrl?: string;
  autoSubmit?: boolean;
  /** One row for the desktop header: the label and the hint stay for screen readers only. */
  compact?: boolean;
  /** A fixed id for the field, when something else on the page must find it (the recents send the focus back). */
  fieldId?: string;
}) {
  const t = useTranslations("Capture");
  const router = useRouter();
  const generatedFieldId = useId();
  const ids = { field: fieldId ?? generatedFieldId, hint: useId(), error: useId() };
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(autoSubmit);
  const [error, setError] = useState<ErrorKey | null>(null);
  const started = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  const fail = (key: ErrorKey) => {
    setBusy(false);
    setError(key);
    input.current?.focus();
  };

  const submit = async (value: string) => {
    const link = value.trim();
    if (!isHttpUrl(link)) return fail("invalidUrl");
    setBusy(true);
    setError(null);
    const result = await createCapture(link);
    if (!result.ok) {
      return fail(
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

  // Back/forward cache: a page restored mid-request must not keep a disabled button.
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(url);
  };

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className={`flex w-full gap-space-3 text-left ${compact ? "flex-row flex-wrap items-center gap-space-2" : "flex-col"}`}
    >
      <label htmlFor={ids.field} className={compact ? "sr-only" : "font-strong"}>
        {t("field")}
      </label>
      <input
        ref={input}
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
        className={compact ? `${inputClass} min-w-space-0 flex-1` : inputClass}
      />
      <p id={ids.hint} className={compact ? "sr-only" : "text-sm text-ink-muted"}>
        {t("hint")}
      </p>
      {error && (
        <p id={ids.error} role="alert" className={compact ? "basis-full text-sm text-danger" : "text-danger"}>
          {t(`errors.${error}`)}
        </p>
      )}
      {busy && autoSubmit && !error && <p role="status">{t("share.adding")}</p>}
      <button type="submit" className={primaryButtonClass} disabled={busy}>
        {busy ? t("busy") : t("submit")}
      </button>
    </form>
  );
}
