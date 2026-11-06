import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ProfilesSettings } from "@/components/profiles-settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.profiles");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

export default function Page() {
  return <ProfilesSettings />;
}
