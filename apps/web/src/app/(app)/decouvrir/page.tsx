import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Discover");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

/** « Découvrir » (refonte Boudoir, spec §2 R4): its place in the menu now, the catalogue later (task 6). */
export default async function Page() {
  const t = await getTranslations("Discover");
  return (
    <div className="flex flex-col gap-space-3 pt-space-5 pb-space-6">
      <h1 className="font-title text-title">{t("title")}</h1>
      <p className="max-w-measure text-ink-muted">{t("soon")}</p>
    </div>
  );
}
