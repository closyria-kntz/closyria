import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CopySentence } from "@/components/copy-sentence";
import { focusRing, primaryButtonClass } from "@/components/ui";
import { IOS_SHORTCUT_URL } from "@/lib/ios-shortcut";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("IphoneHelp");
  return { title: t("metadata") };
}

const numberClass =
  "flex size-space-6 shrink-0 items-center justify-center rounded-full bg-button-bg text-sm font-strong text-button-ink";
const sectionClass = "flex flex-col gap-space-3 rounded-card border border-line bg-surface-raised p-space-4";

/**
 * Adding from an iPhone (decisions of 2026-11-12): first « Installer le raccourci » (the founder's « Envoyer à
 * Closyria », which opens `/partager?url=` + the shared link); or a sentence to give the iPhone's AI, which builds the
 * shortcut; or « Coller le lien copié » in 2 gestures (copy in the shop, then + → « Coller le lien copié »).
 */
export default async function Page() {
  const t = await getTranslations("IphoneHelp");
  const paste = [1, 2] as const;
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

      {IOS_SHORTCUT_URL && (
        <section aria-labelledby="iphone-shortcut" className={sectionClass}>
          <h2 id="iphone-shortcut" className="font-display text-lead font-strong">
            {t("shortcutTitle")}
          </h2>
          <a
            href={IOS_SHORTCUT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`${primaryButtonClass} min-h-touch-target self-start`}
          >
            {t("install")}
          </a>
          <p className="text-ink-muted">{t("installNote")}</p>
        </section>
      )}

      <section aria-labelledby="iphone-ai" className={sectionClass}>
        <h2 id="iphone-ai" className="font-display text-lead font-strong">
          {t("aiTitle")}
        </h2>
        <p className="text-ink-muted">{t("aiIntro")}</p>
        <CopySentence
          label={t("aiLabel")}
          text={t("aiSentence")}
          copyLabel={t("copy")}
          copiedLabel={t("copied")}
          failedLabel={t("copyFailed")}
        />
      </section>

      <section aria-labelledby="iphone-paste" className={sectionClass}>
        <h2 id="iphone-paste" className="font-display text-lead font-strong">
          {t("pasteTitle")}
        </h2>
        <ol aria-label={t("pasteLabel")} className="flex flex-col gap-space-3">
          {paste.map((index) => (
            <li key={index} className="flex gap-space-3">
              <span aria-hidden="true" className={numberClass}>
                {index}
              </span>
              <p>{t(`paste.${index}`)}</p>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
