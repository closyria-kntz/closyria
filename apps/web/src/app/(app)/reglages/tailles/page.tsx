import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SizesSettings } from "@/components/sizes-settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.sizes");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

export default function Page() {
  return (
    <Suspense>
      <SizesSettings />
    </Suspense>
  );
}
