import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TagsSettings } from "@/components/tags-settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.tags");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

export default function Page() {
  return <TagsSettings />;
}
