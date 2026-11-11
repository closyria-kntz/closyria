"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { focusRing, inputClass, primaryButtonClass } from "@/components/ui";
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

/** On the burgundy add box of « Accueil »: a white pill field with the ochre « Ajouter » beside it. */
const boxInputClass = `min-w-space-0 flex-1 rounded-pill bg-surface-raised px-space-3-5 py-space-3 text-control text-ink placeholder:text-ink-muted ${focusRing}`;
const boxButtonClass = `inline-flex min-h-touch-target shrink-0 items-center justify-center rounded-pill bg-label px-space-4 text-sm font-bold text-label-ink disabled:opacity-60 ${focusRing}`;

/**
 * « Coller un lien » → « Ajouter »: starts the capture, then opens the product page, which follows it.
 * With `autoSubmit` (the Android share target) the link it is given is added at once. The `box` look is the add box
 * of « Accueil » (its title is the box's; the field keeps the name « Coller un lien » for screen readers).
 */
export function CaptureForm({
  initialUrl = "",
  autoSubmit = false,
  fieldId,
  look = "plain",
}: {
  initialUrl?: string;
  autoSubmit?: boolean;
  /** A fixed id for the field, when something else on the page must find it (the recents send the focus back). */
  fieldId?: string;
  look?: "plain" | "box";
}) {
  const t = useTranslations("Capture");
  const tHome = useTranslations("Home.add");
  const box = look === "box";
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

  const field = (
    <input
      ref={input}
      id={ids.field}
      name="url"
      type="url"
      inputMode="url"
      autoComplete="off"
      autoCapitalize="none"
      spellCheck={false}
      placeholder={box ? tHome("placeholder") : t("placeholder")}
      value={url}
      onChange={(e) => setUrl(e.target.value)}
      aria-invalid={error === "invalidUrl" || undefined}
      aria-describedby={error ? `${ids.hint} ${ids.error}` : ids.hint}
      className={box ? boxInputClass : inputClass}
    />
  );
  const submitButton = (
    <button type="submit" className={box ? boxButtonClass : primaryButtonClass} disabled={busy}>
      {busy ? t("busy") : t("submit")}
    </button>
  );

  return (
    <form noValidate onSubmit={onSubmit} className="flex w-full flex-col gap-space-3 text-left">
      <label htmlFor={ids.field} className={box ? "sr-only" : "font-strong"}>
        {t("field")}
      </label>
      {box ? (
        <div className="flex items-center gap-space-2">
          {field}
          {submitButton}
        </div>
      ) : (
        field
      )}
      <p id={ids.hint} className={box ? "text-sm" : "text-sm text-ink-muted"}>
        {box ? tHome("more") : t("hint")}
      </p>
      {error && (
        <p id={ids.error} role="alert" className={box ? "font-bold" : "text-danger"}>
          {t(`errors.${error}`)}
        </p>
      )}
      {busy && autoSubmit && !error && <p role="status">{t("share.adding")}</p>}
      {!box && submitButton}
    </form>
  );
}
