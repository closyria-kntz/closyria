"use client";

import { createAuthClient } from "@closyria/auth/client";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { useAccount } from "@/lib/profile-context";
import { forgetThisDevice } from "@/lib/push";
import { buttonClass, primaryButtonClass } from "./ui";

const HERE = "/reglages/compte";

/**
 * « Mon compte »: who is signed in, and « Se déconnecter ». Without an account there is nothing to sign out of
 * (her items would be lost with the session): she is offered to create one instead.
 */
export function AccountSettings() {
  const t = useTranslations("Settings.account");
  const format = useFormatter();
  const account = useAccount();
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");

  async function signOut() {
    setState("busy");
    // While her session still exists: this device stops receiving her notifications (a shared computer).
    await forgetThisDevice();
    const result = await createAuthClient(window.location.origin)
      .signOut()
      .catch(() => ({ error: true }));
    if (result.error) {
      setState("failed");
      return;
    }
    // A full load: nothing of her session stays in memory.
    window.location.assign("/connexion");
  }

  return (
    <section className="flex max-w-measure flex-col gap-space-4">
      <h2 className="font-display text-lead font-strong">{t("title")}</h2>
      {account === null ? (
        <p role="status">{t("loading")}</p>
      ) : account.email === null ? (
        <>
          <p className="font-strong">{t("anonymousTitle")}</p>
          <p>{t("anonymousBody")}</p>
          <div>
            <Link
              href={`/connexion?next=${encodeURIComponent(HERE)}`}
              className={`${primaryButtonClass} min-h-touch-target`}
            >
              {t("create")}
            </Link>
          </div>
        </>
      ) : (
        <>
          <dl className="flex flex-col gap-space-1">
            <dt className="text-sm text-ink-muted">{t("email")}</dt>
            <dd className="break-all font-strong">{account.email}</dd>
          </dl>
          <p className="text-sm text-ink-muted">
            {t("createdAt", { date: format.dateTime(new Date(account.createdAt), { dateStyle: "long" }) })}
          </p>
          <div>
            <button
              type="button"
              disabled={state === "busy"}
              onClick={() => void signOut()}
              className={`${buttonClass} min-h-touch-target`}
            >
              {state === "busy" ? t("signingOut") : t("signOut")}
            </button>
          </div>
          {state === "failed" && <p role="alert">{t("signOutFailed")}</p>}
        </>
      )}
    </section>
  );
}
