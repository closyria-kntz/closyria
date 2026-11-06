import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { focusRing } from "@/components/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("IphoneHelp");
  return { title: t("metadata") };
}

/** How to build the iOS Shortcut « Envoyer à Closyria » (text only: the shortcut file is not in the repository). */
export default async function Page() {
  const t = await getTranslations("IphoneHelp");
  const steps = [1, 2, 3, 4] as const;
  return (
    <article className="flex max-w-measure flex-col gap-space-4 pb-space-6">
      <Link
        href="/reglages/profils"
        className={`inline-flex min-h-touch-target items-center self-start rounded-button text-sm text-accent ${focusRing}`}
      >
        {t("back")}
      </Link>
      <h1 className="font-display text-title font-strong">{t("title")}</h1>
      <p>{t("intro")}</p>
      <ol aria-label={t("stepsLabel")} className="flex flex-col gap-space-4">
        {steps.map((index) => (
          <li key={index} className="flex gap-space-3 rounded-card border border-line bg-surface-raised p-space-4">
            <span
              aria-hidden="true"
              className="flex size-space-6 shrink-0 items-center justify-center rounded-full bg-button-bg text-sm font-strong text-button-ink"
            >
              {index}
            </span>
            <div className="flex min-w-space-0 flex-col gap-space-2">
              <h2 className="font-display text-lead font-strong">{t(`steps.${index}.title`)}</h2>
              <p className="text-ink-muted">{t(`steps.${index}.body`)}</p>
              {index === 3 && (
                <p className="flex flex-col gap-space-1">
                  <span className="text-sm font-strong">{t("addressLabel")}</span>
                  <code className="break-all rounded-button bg-surface-sunken px-space-3 py-space-2 text-sm">
                    {t("address")}
                  </code>
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="text-sm text-ink-muted">{t("note")}</p>
    </article>
  );
}
