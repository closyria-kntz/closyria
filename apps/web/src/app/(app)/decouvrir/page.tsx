import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DiscoverScreen } from "@/components/discover-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Discover");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

/** « Découvrir » (refonte Boudoir, spec §6): the shops Closyria knows and the « boutique de la semaine ». */
export default function Page() {
  return <DiscoverScreen />;
}
