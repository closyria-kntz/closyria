import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { MePlaces } from "@/components/me-places";
import { ThemeButton } from "@/components/theme-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Me");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

/** « Moi » (refonte Boudoir, spec §2 R6): for now, a written list of her pages (the real page comes in task 7). */
export default async function Page() {
  const t = await getTranslations("Me");
  return (
    <div className="flex flex-col gap-space-4 pt-space-5 pb-space-6">
      <div className="flex items-start justify-between gap-space-3">
        <div className="flex flex-col gap-space-2">
          <h1 className="font-title text-title">{t("title")}</h1>
          <p className="text-ink-muted">{t("intro")}</p>
        </div>
        <ThemeButton />
      </div>
      <Suspense>
        <MePlaces />
      </Suspense>
    </div>
  );
}
