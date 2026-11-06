"use client";

import { createAuthClient } from "@closyria/auth/client";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { buttonClass, inputClass, primaryButtonClass } from "@/components/ui";
import { type CodeErrorKey, codeErrorKey, isSixDigitCode, type SendErrorKey, sendErrorKey } from "@/lib/sign-in";

type ErrorKey = SendErrorKey | CodeErrorKey | "invalidEmail" | "invalidCodeFormat";

/** The API is on the same origin, under /api/auth. */
const authClient = () => createAuthClient(window.location.origin);

/** E-mail → « Recevoir mon code » → 6-digit code → « Me connecter », then a full load of `next`. */
export function SignInForm({ next }: { next: string }) {
  const t = useTranslations("SignIn");
  const ids = { email: useId(), code: useId(), hint: useId(), error: useId() };
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  // Bumped each time a code has been sent (first send or resend): the code field takes the focus.
  const [codeSentCount, setCodeSentCount] = useState(0);

  // An effect, not a `requestAnimationFrame` in `sendCode`: that state update is made after an `await`, and under
  // load the frame could fire before React had committed the code step (ref still null, focus lost).
  useEffect(() => {
    if (codeSentCount > 0) codeInput.current?.focus();
  }, [codeSentCount]);

  const sendCode = async (event?: FormEvent) => {
    event?.preventDefault();
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return setError("invalidEmail");
    setBusy(true);
    setError(null);
    const result = await authClient()
      .emailOtp.sendVerificationOtp({ email: address, type: "sign-in" })
      .catch(() => ({ error: { status: 0 } }));
    setBusy(false);
    if (result.error) return setError(sendErrorKey(result.error));
    setCode("");
    setStep("code");
    // The code field appears: move the focus there (keyboard and screen reader users), see the effect above.
    setCodeSentCount((n) => n + 1);
  };

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    const otp = code.trim();
    if (!isSixDigitCode(otp)) return setError("invalidCodeFormat");
    setBusy(true);
    setError(null);
    const result = await authClient()
      .signIn.emailOtp({ email: email.trim(), otp })
      .catch(() => ({ error: { status: 0 } }));
    if (result.error) {
      setBusy(false);
      return setError(codeErrorKey(result.error));
    }
    // A full load: the server renders the next page with the new session.
    window.location.assign(next);
  };

  const errorMessage = error ? (
    <p id={ids.error} role="alert" className="text-danger">
      {t(`errors.${error}`)}
    </p>
  ) : null;
  const describedBy = (...list: (string | false)[]) => list.filter(Boolean).join(" ") || undefined;

  if (step === "email") {
    return (
      <form noValidate onSubmit={sendCode} className="flex flex-col gap-space-3">
        <label htmlFor={ids.email} className="font-strong">
          {t("emailLabel")}
        </label>
        <input
          id={ids.email}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error === "invalidEmail" || undefined}
          aria-describedby={describedBy(Boolean(error) && ids.error)}
          className={inputClass}
        />
        {errorMessage}
        <button type="submit" className={primaryButtonClass} disabled={busy}>
          {busy ? t("busy") : t("sendCode")}
        </button>
      </form>
    );
  }

  return (
    <form noValidate onSubmit={signIn} className="flex flex-col gap-space-3">
      <p role="status">{t("codeSent", { email: email.trim() })}</p>
      <label htmlFor={ids.code} className="font-strong">
        {t("codeLabel")}
      </label>
      <input
        ref={codeInput}
        id={ids.code}
        name="code"
        type="text"
        autoComplete="one-time-code"
        inputMode="numeric"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        aria-invalid={error === "invalidCode" || error === "invalidCodeFormat" || undefined}
        aria-describedby={describedBy(ids.hint, Boolean(error) && ids.error)}
        className={`${inputClass} tabular-nums`}
      />
      <p id={ids.hint} className="text-sm text-ink-muted">
        {t("codeHint")}
      </p>
      {errorMessage}
      <button type="submit" className={primaryButtonClass} disabled={busy}>
        {busy ? t("busy") : t("signIn")}
      </button>
      <div className="flex flex-wrap gap-space-2">
        <button type="button" className={buttonClass} disabled={busy} onClick={() => sendCode()}>
          {t("resend")}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={() => {
            setError(null);
            setStep("email");
          }}
        >
          {t("otherEmail")}
        </button>
      </div>
    </form>
  );
}
