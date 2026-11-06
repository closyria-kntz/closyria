import Link from "next/link";
import { getTranslations } from "next-intl/server";

/** A stopped, unknown or incomplete share link. */
export default async function SharedListNotFound() {
  const t = await getTranslations("SharedList.notFound");
  return (
    <main className="mx-auto flex min-h-dvh max-w-narrow flex-col justify-center gap-space-4 px-space-5 py-space-7">
      <h1 className="font-display text-title font-strong">{t("title")}</h1>
      <p className="text-ink-muted">{t("body")}</p>
      <Link href="/" className="self-start text-accent underline">
        {t("home")}
      </Link>
    </main>
  );
}
