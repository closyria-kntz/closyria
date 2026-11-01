import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAdminAccess } from "../server";
import { PasskeyActions } from "./passkey-actions";

/**
 * For an admin signed in without a passkey (point de vigilance 4): explains how to get one, never loops.
 * Non-admins never get here (the admin layout answers 404); an admin already on a passkey goes to /admin.
 */
export default async function PasskeyRequiredPage() {
  const access = await getAdminAccess();
  if (access === "not-found") notFound(); // also checked by the admin layout, which renders concurrently
  if (access === "ok") redirect("/admin");
  const t = await getTranslations("Admin.passkey");
  return (
    <main className="mx-auto flex min-h-dvh max-w-narrow flex-col justify-center gap-space-4 px-space-5 py-space-7">
      <h1 className="font-display text-title font-strong">{t("title")}</h1>
      <p>{t("intro")}</p>
      <section aria-labelledby="passkey-steps" className="flex flex-col gap-space-2">
        <h2 id="passkey-steps" className="text-lead font-strong">
          {t("stepsTitle")}
        </h2>
        <ol className="flex list-decimal flex-col gap-space-2 ps-space-5">
          <li>{t("step1")}</li>
          <li>{t("step2")}</li>
          <li>{t("step3")}</li>
        </ol>
      </section>
      <PasskeyActions
        labels={{
          register: t("register"),
          signIn: t("signIn"),
          registered: t("registered"),
          registerFailed: t("registerFailed"),
          signInFailed: t("signInFailed"),
        }}
      />
    </main>
  );
}
