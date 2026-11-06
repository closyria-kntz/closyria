import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TrashSettings } from "@/components/trash-settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.trash");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

export default function Page() {
  return <TrashSettings />;
}
