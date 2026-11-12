import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CopySentence } from "@/components/copy-sentence";
import { focusRing, primaryButtonClass } from "@/components/ui";
import { IOS_SHORTCUT_URL } from "@/lib/ios-shortcut";
import { phoneKind } from "@/lib/phone-kind";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("PhoneHelp");
  return { title: t("metadata") };
}

type Translate = Awaited<ReturnType<typeof getTranslations<"PhoneHelp">>>;

const numberClass =
  "flex size-space-6 shrink-0 items-center justify-center rounded-full bg-button-bg text-sm font-strong text-button-ink";
const sectionClass = "flex flex-col gap-space-3 rounded-card border border-line bg-surface-raised p-space-4";
const partClass = "flex scroll-mt-space-4 flex-col gap-space-4";

/** « Coller le lien copié » in 2 gestures (copy in the shop, then + → « Coller le lien copié »). */
function PasteSteps({ t, id, title }: { t: Translate; id: string; title: string }) {
  return (
    <section aria-labelledby={id} className={sectionClass}>
      <h3 id={id} className="font-display text-lead font-strong">
        {title}
      </h3>
      <ol aria-label={t("pasteLabel")} className="flex flex-col gap-space-3">
        {([1, 2] as const).map((index) => (
          <li key={index} className="flex gap-space-3">
            <span aria-hidden="true" className={numberClass}>
              {index}
            </span>
            <p>{t(`paste.${index}`)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function IphonePart({ t }: { t: Translate }) {
  return (
    <section id="iphone" aria-labelledby="iphone-title" className={partClass}>
      <h2 id="iphone-title" className="font-display text-title font-strong">
        {t("iphoneSection")}
      </h2>
      <p>{t("iphoneIntro")}</p>

      {IOS_SHORTCUT_URL && (
        <section aria-labelledby="iphone-shortcut" className={sectionClass}>
          <h3 id="iphone-shortcut" className="font-display text-lead font-strong">
            {t("shortcutTitle")}
          </h3>
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
        <h3 id="iphone-ai" className="font-display text-lead font-strong">
          {t("aiTitle")}
        </h3>
        <p className="text-ink-muted">{t("aiIntro")}</p>
        <CopySentence
          label={t("aiLabel")}
          text={t("aiSentence")}
          copyLabel={t("copy")}
          copiedLabel={t("copied")}
          failedLabel={t("copyFailed")}
        />
      </section>

      <PasteSteps t={t} id="iphone-paste" title={t("pasteTitle")} />
    </section>
  );
}

/** Android: the installed web app (manifest `share_target` → `/partager`) shows up in the share sheet. */
function AndroidPart({ t }: { t: Translate }) {
  return (
    <section id="android" aria-labelledby="android-title" className={partClass}>
      <h2 id="android-title" className="font-display text-title font-strong">
        {t("androidSection")}
      </h2>
      <p>{t("androidIntro")}</p>

      <section aria-labelledby="android-install" className={sectionClass}>
        <h3 id="android-install" className="font-display text-lead font-strong">
          {t("androidInstallTitle")}
        </h3>
        <p>{t("androidInstall")}</p>
      </section>

      <section aria-labelledby="android-share" className={sectionClass}>
        <h3 id="android-share" className="font-display text-lead font-strong">
          {t("androidShareTitle")}
        </h3>
        <p>{t("androidShare")}</p>
      </section>

      <PasteSteps t={t} id="android-paste" title={t("androidPasteTitle")} />
    </section>
  );
}

/**
 * Adding from a phone (decisions of 2026-11-12): « Sur iPhone » (the founder's shortcut « Envoyer à Closyria », a
 * sentence for the iPhone's AI, or « Coller le lien copié ») and « Sur Android » (install the app from Chrome, then
 * Partager → Closyria, or « Coller le lien copié »). The detected phone's part comes first, the other stays below; a
 * computer sees iPhone then Android.
 */
export default async function Page() {
  const t = await getTranslations("PhoneHelp");
  // An Android phone's part first, otherwise the iPhone's (an iPhone, an iPad, a computer).
  const first = phoneKind((await headers()).get("user-agent") ?? "") === "android" ? "android" : "iphone";
  const iphone = <IphonePart key="iphone" t={t} />;
  const android = <AndroidPart key="android" t={t} />;
  return (
    <article className="flex max-w-measure flex-col gap-space-5 pb-space-6">
      <Link
        href="/moi"
        className={`inline-flex min-h-touch-target items-center self-start rounded-button text-sm text-accent ${focusRing}`}
      >
        {t("back")}
      </Link>
      <h1 className="font-display text-title font-strong">{t("title")}</h1>
      <p>{t("intro")}</p>
      {first === "android" ? [android, iphone] : [iphone, android]}
    </article>
  );
}
