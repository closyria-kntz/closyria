import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { WardrobeView } from "@/components/wardrobe-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Views.metadata");
  return { title: t("envies"), robots: { index: false, follow: false } };
}

export default function Page() {
  return (
    <Suspense>
      <WardrobeView view="envies" />
    </Suspense>
  );
}
