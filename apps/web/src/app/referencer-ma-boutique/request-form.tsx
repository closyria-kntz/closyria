"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ConsentFields, type ConsentValues, FieldError } from "@/components/consent-fields";
import { focusRing, inputClass, primaryButtonClass, textareaClass } from "@/components/ui";
import { type ConsentField, type RequestField, requestErrors, sendListingRequest } from "@/lib/listing";

type Values = ConsentValues & { shopName: string; siteUrl: string; message: string; website: string };

/** The request: the shop, its site, the person, a message, the two boxes; a hidden honeypot for robots. */
export function RequestForm({ version }: { version: string }) {
  const t = useTranslations("Listing");
  const [values, setValues] = useState<Values>({
    shopName: "",
    siteUrl: "",
    name: "",
    email: "",
    message: "",
    website: "",
    authorized: false,
    accepted: false,
  });
  const [errors, setErrors] = useState<RequestField[]>([]);
  const [sendError, setSendError] = useState<"tooMany" | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const doneTitle = useRef<HTMLHeadingElement>(null);
  // Once the thanks are on screen, the focus goes to them (a screen reader reads them).
  useEffect(() => {
    if (done) doneTitle.current?.focus();
  }, [done]);
  const refs = {
    shopName: useRef<HTMLInputElement>(null),
    siteUrl: useRef<HTMLInputElement>(null),
    name: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    authorized: useRef<HTMLInputElement>(null),
    accepted: useRef<HTMLInputElement>(null),
  };
  const set = (next: Partial<Values>) => setValues((v) => ({ ...v, ...next }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const input = { ...values, version };
    const bad = requestErrors(input);
    setErrors(bad);
    setSendError(null);
    const [first] = bad;
    if (first) return refs[first].current?.focus();
    setBusy(true);
    const result = await sendListingRequest(input);
    setBusy(false);
    if (!result.ok) return setSendError(result.error === "tooMany" ? "tooMany" : "failed");
    setDone(true);
  };

  if (done) {
    return (
      <section
        aria-labelledby="request-done"
        data-testid="request-done"
        className="flex flex-col gap-space-3 rounded-card bg-une p-space-4 md:p-space-5"
      >
        <h2 id="request-done" ref={doneTitle} tabIndex={-1} className="font-title text-section-title font-regular">
          {t("request.doneTitle")}
        </h2>
        <p>{t("request.doneBody")}</p>
        <Link href="/decouvrir" className={`self-start text-accent underline ${focusRing}`}>
          {t("request.back")}
        </Link>
      </section>
    );
  }

  const shopField = (field: "shopName" | "siteUrl") => {
    const id = `request-${field}`;
    const hint = field === "siteUrl" ? `${id}-hint` : null;
    const invalid = errors.includes(field);
    return (
      <div className="flex flex-col gap-space-1-5">
        <label htmlFor={id} className="font-strong">
          {t(`request.${field}`)}
        </label>
        <input
          ref={refs[field]}
          id={id}
          name={field}
          required
          {...(field === "siteUrl"
            ? {
                inputMode: "url" as const,
                autoCapitalize: "none",
                spellCheck: false,
                autoComplete: "url",
                maxLength: 2048,
              }
            : { autoComplete: "organization", maxLength: 120 })}
          value={values[field]}
          onChange={(e) => set({ [field]: e.target.value })}
          aria-invalid={invalid || undefined}
          aria-describedby={[invalid ? `${id}-error` : null, hint].filter(Boolean).join(" ") || undefined}
          className={`${inputClass} min-h-touch-target`}
        />
        {hint && (
          <p id={hint} className="text-sm text-ink-muted">
            {t("request.siteUrlHint")}
          </p>
        )}
        <FieldError id={`${id}-error`} text={invalid ? t(`request.errors.${field}`) : null} />
      </div>
    );
  };

  return (
    <form
      noValidate
      onSubmit={submit}
      aria-label={t("request.title")}
      className="flex flex-col gap-space-4 rounded-card bg-surface-raised p-space-4 md:p-space-5"
    >
      {shopField("shopName")}
      {shopField("siteUrl")}
      <ConsentFields
        idPrefix="request"
        values={values}
        onChange={set}
        errors={errors.filter((e): e is ConsentField => e !== "shopName" && e !== "siteUrl")}
        version={version}
        refs={refs}
      />
      <div className="flex flex-col gap-space-1-5">
        <label htmlFor="request-message" className="font-strong">
          {t("request.message")}
        </label>
        <textarea
          id="request-message"
          name="message"
          rows={4}
          maxLength={2000}
          value={values.message}
          onChange={(e) => set({ message: e.target.value })}
          className={`${textareaClass} field-sizing-content`}
        />
      </div>
      {/* Honeypot: off-screen and out of the tab order; a person never fills it. */}
      <div aria-hidden="true" className="sr-only">
        <label htmlFor="request-website">{t("request.honeypot")}</label>
        <input
          id="request-website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={values.website}
          onChange={(e) => set({ website: e.target.value })}
        />
      </div>
      <p role="alert" className="text-danger empty:hidden">
        {sendError === "tooMany" ? t("request.errors.tooMany") : sendError ? t("errors.failed") : ""}
      </p>
      <button type="submit" disabled={busy} className={`${primaryButtonClass} min-h-touch-target`}>
        {busy ? t("busy") : t("request.submit")}
      </button>
    </form>
  );
}
