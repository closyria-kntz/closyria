"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { ConsentFields, type ConsentValues } from "@/components/consent-fields";
import { CopySentence } from "@/components/copy-sentence";
import { focusRing, primaryButtonClass } from "@/components/ui";
import {
  acceptErrors,
  acceptInvitation,
  type ConsentField,
  MANAGE_PAGE,
  manageUrl,
  type SendError,
} from "@/lib/listing";

/**
 * The invitation page's body: the server-rendered introduction and conditions, then the agreement's form. On success
 * the whole page becomes the thanks, « Merci ! {Boutique} est référencée sur Closyria. », with the private management
 * link (withdrawal) to keep, the invitation itself being used up; the conditions stay readable, folded.
 */
export function InvitationFlow({
  token,
  shopName,
  version,
  intro,
  conditions,
}: {
  token: string;
  shopName: string;
  version: string;
  intro: ReactNode;
  conditions: ReactNode;
}) {
  const t = useTranslations("Listing");
  const [values, setValues] = useState<ConsentValues>({ name: "", email: "", authorized: false, accepted: false });
  const [errors, setErrors] = useState<ConsentField[]>([]);
  const [sendError, setSendError] = useState<SendError | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ shopName: string; manageToken: string } | null>(null);
  const doneTitle = useRef<HTMLHeadingElement>(null);
  // Once the thanks are on screen, the focus goes to them (a screen reader reads them).
  useEffect(() => {
    if (done) doneTitle.current?.focus();
  }, [done]);
  const refs = {
    name: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    authorized: useRef<HTMLInputElement>(null),
    accepted: useRef<HTMLInputElement>(null),
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const input = { ...values, version };
    const bad = acceptErrors(input);
    setErrors(bad);
    setSendError(null);
    const [first] = bad;
    if (first) return refs[first].current?.focus();
    setBusy(true);
    const result = await acceptInvitation(token, input);
    setBusy(false);
    if (!result.ok) return setSendError(result.error);
    setDone(result.data);
  };

  if (done) {
    const link = manageUrl(window.location.origin, done.manageToken);
    return (
      <div data-testid="listing-done" className="flex flex-col gap-space-4">
        <h1 ref={doneTitle} tabIndex={-1} className="font-title text-page-title leading-tight font-regular break-words">
          {t("done.title", { shop: done.shopName })}
        </h1>
        <section className="flex flex-col gap-space-3 rounded-card bg-une p-space-4 md:p-space-5">
          <p>{t("done.body")}</p>
          <p className="font-strong">{t("done.keep")}</p>
          <a
            href={`${MANAGE_PAGE}/${done.manageToken}`}
            className={`${primaryButtonClass} min-h-touch-target self-start`}
          >
            {t("done.manage")}
          </a>
          <CopySentence
            label={t("done.linkLabel")}
            text={link}
            copyLabel={t("done.copy")}
            copiedLabel={t("done.copied")}
            failedLabel={t("done.copyFailed")}
          />
        </section>
        <details className="group flex flex-col gap-space-3">
          <summary
            className={`inline-flex min-h-touch-target cursor-pointer items-center font-strong text-accent underline ${focusRing}`}
          >
            {t("done.reread")}
          </summary>
          <div className="pt-space-3">{conditions}</div>
        </details>
      </div>
    );
  }

  return (
    <>
      {intro}
      {conditions}
      <form
        noValidate
        onSubmit={submit}
        aria-labelledby="listing-form-title"
        className="flex flex-col gap-space-4 rounded-card bg-surface-raised p-space-4 md:p-space-5"
      >
        <h2 id="listing-form-title" className="font-title text-section-title font-regular">
          {t("invitation.formTitle")}
          <span className="sr-only"> · {shopName}</span>
        </h2>
        <ConsentFields
          idPrefix="invitation"
          values={values}
          onChange={(next) => setValues((v) => ({ ...v, ...next }))}
          errors={errors}
          version={version}
          refs={refs}
        />
        <p role="alert" className="text-danger empty:hidden">
          {sendError === "invalid" ? t("invalid.title") : sendError ? t(`errors.${sendError}`) : ""}
        </p>
        <button type="submit" disabled={busy} className={`${primaryButtonClass} min-h-touch-target`}>
          {busy ? t("busy") : t("invitation.submit")}
        </button>
        <p className="sr-only" aria-live="polite">
          {errors.length > 0 ? t("fixErrors") : ""}
        </p>
      </form>
    </>
  );
}
