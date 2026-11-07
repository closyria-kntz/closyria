import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LoveLevelsSettings } from "@/components/love-levels-settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.levels");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

export default function Page() {
  return <LoveLevelsSettings />;
}
