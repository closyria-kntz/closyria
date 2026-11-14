import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NewsScreen } from "@/components/news-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("News");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

/** « Nouvelles » (chantier 4 « Alertes »): her alerts of the last 30 days. */
export default function Page() {
  return <NewsScreen />;
}
