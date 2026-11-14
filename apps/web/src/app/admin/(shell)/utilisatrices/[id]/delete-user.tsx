"use client";

import { GUEST_DELETE_CONFIRMATION } from "@closyria/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { adminRequest } from "@/lib/admin-catalog";
import { deleteConfirmed, userDeleteErrorKey } from "@/lib/admin-users";
import { buttonClass, inputClass, primaryButtonClass } from "../../../ui";

/**
 * « Supprimer ce compte » (RGPD, on her request): opens a short form where the admin types her e-mail (« SUPPRIMER »
 * for a guest) before the final button works. The API checks the same text, deletes everything and audits it.
 */
export function DeleteUser({ userId, email }: { userId: string; email: string | null }) {
  const t = useTranslations("Admin.users.delete");
  const router = useRouter();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const ready = deleteConfirmed(typed, email);

  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    setTyped("");
    trigger.current?.focus();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setMessage(null);
    const res = await adminRequest("DELETE", `/api/admin/users/${encodeURIComponent(userId)}`, {
      confirmation: typed.trim(),
    });
    if (res.ok) {
      router.push("/admin/utilisatrices");
      return router.refresh();
    }
    setBusy(false);
    setMessage(t(userDeleteErrorKey(res.status, res.body)));
  };

  return (
    <div className="flex flex-col gap-space-3">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        className={`${buttonClass} min-h-touch-target self-start`}
        onClick={() => {
          setMessage(null);
          setOpen(true);
        }}
      >
        {t("open")}
      </button>
      {open ? (
        <form
          aria-label={t("title")}
          onSubmit={submit}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !busy) close();
          }}
          className="flex flex-col gap-space-3 rounded-card border border-line bg-surface-sunken p-space-3"
        >
          <label htmlFor={fieldId} className="text-sm font-strong break-all">
            {email === null ? t("confirmGuest", { word: GUEST_DELETE_CONFIRMATION }) : t("confirmAccount", { email })}
          </label>
          <input
            ref={field}
            id={fieldId}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className={`${inputClass} min-h-touch-target max-w-measure`}
          />
          <div className="flex flex-wrap gap-space-2">
            <button type="submit" disabled={!ready || busy} className={`${primaryButtonClass} min-h-touch-target`}>
              {busy ? t("deleting") : t("confirm")}
            </button>
            <button type="button" className={`${buttonClass} min-h-touch-target`} disabled={busy} onClick={close}>
              {t("cancel")}
            </button>
          </div>
        </form>
      ) : null}
      <p role="status" aria-live="polite" className="text-sm text-danger">
        {message}
      </p>
    </div>
  );
}
