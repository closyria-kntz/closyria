"use client";

import { useTranslations } from "next-intl";
import type { RefObject } from "react";
import type { ConsentField } from "@/lib/listing";
import { inputClass } from "./ui";

export type ConsentValues = { name: string; email: string; authorized: boolean; accepted: boolean };

/** One error under a field, linked to it (`aria-describedby`). */
export function FieldError({ id, text }: { id: string; text: string | null }) {
  if (!text) return null;
  return (
    <p id={id} className="text-sm text-danger">
      {text}
    </p>
  );
}

const checkLabel = "flex min-h-touch-target cursor-pointer items-start gap-space-3 py-space-1";
const checkBox = "mt-space-0-5 size-space-5 shrink-0 accent-accent";

/**
 * « Votre nom », « Votre e-mail » and the two boxes (« habilité·e », « J'accepte les conditions ») of the invitation
 * page and of the request form. Each refused field says why, under it.
 */
export function ConsentFields({
  idPrefix,
  values,
  onChange,
  errors,
  version,
  refs,
}: {
  idPrefix: string;
  values: ConsentValues;
  onChange: (next: Partial<ConsentValues>) => void;
  errors: readonly ConsentField[];
  version: string;
  refs: Partial<Record<ConsentField, RefObject<HTMLInputElement | null>>>;
}) {
  const t = useTranslations("Listing");
  const id = (f: string) => `${idPrefix}-${f}`;
  const error = (f: ConsentField) => (errors.includes(f) ? t(`errors.${f}`) : null);
  const described = (f: ConsentField, hint?: string) =>
    [errors.includes(f) ? id(`${f}-error`) : null, hint].filter(Boolean).join(" ") || undefined;
  return (
    <>
      <div className="flex flex-col gap-space-1-5">
        <label htmlFor={id("name")} className="font-strong">
          {t("nameLabel")}
        </label>
        <input
          ref={refs.name}
          id={id("name")}
          name="name"
          autoComplete="name"
          required
          maxLength={120}
          value={values.name}
          onChange={(e) => onChange({ name: e.target.value })}
          aria-invalid={errors.includes("name") || undefined}
          aria-describedby={described("name")}
          className={`${inputClass} min-h-touch-target`}
        />
        <FieldError id={id("name-error")} text={error("name")} />
      </div>
      <div className="flex flex-col gap-space-1-5">
        <label htmlFor={id("email")} className="font-strong">
          {t("emailLabel")}
        </label>
        <input
          ref={refs.email}
          id={id("email")}
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={254}
          value={values.email}
          onChange={(e) => onChange({ email: e.target.value })}
          aria-invalid={errors.includes("email") || undefined}
          aria-describedby={described("email", id("email-hint"))}
          className={`${inputClass} min-h-touch-target`}
        />
        <p id={id("email-hint")} className="text-sm text-ink-muted">
          {t("emailHint")}
        </p>
        <FieldError id={id("email-error")} text={error("email")} />
      </div>
      <div className="flex flex-col gap-space-1">
        <label className={checkLabel}>
          <input
            ref={refs.authorized}
            type="checkbox"
            name="authorized"
            checked={values.authorized}
            onChange={(e) => onChange({ authorized: e.target.checked })}
            aria-invalid={errors.includes("authorized") || undefined}
            aria-describedby={described("authorized")}
            className={checkBox}
          />
          <span>{t("authorized")}</span>
        </label>
        <FieldError id={id("authorized-error")} text={error("authorized")} />
        <label className={checkLabel}>
          <input
            ref={refs.accepted}
            type="checkbox"
            name="accepted"
            checked={values.accepted}
            onChange={(e) => onChange({ accepted: e.target.checked })}
            aria-invalid={errors.includes("accepted") || undefined}
            aria-describedby={described("accepted")}
            className={checkBox}
          />
          <span>{t("accepted", { version })}</span>
        </label>
        <FieldError id={id("accepted-error")} text={error("accepted")} />
      </div>
    </>
  );
}
