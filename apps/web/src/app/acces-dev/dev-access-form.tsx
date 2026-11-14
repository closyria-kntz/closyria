"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useId, useRef, useState } from "react";
import { inputClass, primaryButtonClass } from "@/components/ui";
import { type DevAccessErrorKey, devAccessErrorKey, devAccessReturnPath } from "@/lib/dev-access";

/**
 * One field, one button. On success the API has set the access cookie: a full load of `suite` (same window, no popup:
 * it must work in a home-screen web app).
 */
export function DevAccessForm() {
  const t = useTranslations("DevAccess");
  const ids = { password: useId(), error: useId() };
  const field = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DevAccessErrorKey | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password) return field.current?.focus();
    setBusy(true);
    setError(null);
    const status = await fetch("/api/dev-access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
      credentials: "same-origin",
    }).then(
      (res) => res.status,
      () => 0,
    );
    if (status === 204) {
      window.location.replace(devAccessReturnPath(window.location.search));
      return;
    }
    setBusy(false);
    setError(devAccessErrorKey(status));
    field.current?.select();
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-space-3">
      <label htmlFor={ids.password} className="font-strong">
        {t("passwordLabel")}
      </label>
      <input
        ref={field}
        id={ids.password}
        name="password"
        type="password"
        autoComplete="current-password"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        aria-invalid={error === "wrongPassword" || undefined}
        aria-describedby={error ? ids.error : undefined}
        className={`${inputClass} min-h-touch-target`}
      />
      {error ? (
        <p id={ids.error} role="alert" className="text-danger">
          {t(`errors.${error}`)}
        </p>
      ) : null}
      <button type="submit" disabled={busy} className={`${primaryButtonClass} min-h-touch-target`}>
        {busy ? t("busy") : t("submit")}
      </button>
    </form>
  );
}
