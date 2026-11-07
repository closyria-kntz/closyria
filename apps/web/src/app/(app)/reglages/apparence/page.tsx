import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AppearanceSettings } from "@/components/appearance-settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.appearance");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

export default function Page() {
  return <AppearanceSettings />;
}
