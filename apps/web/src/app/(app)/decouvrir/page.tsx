import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { DiscoverScreen } from "@/components/discover-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Discover");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

/**
 * « Découvrir » (refonte Boudoir, spec §6; catalogue, spec 2026-11-13 §3.1): her search and filters (in the address),
 * the une, the catalogue's articles and the shops Closyria knows.
 */
export default function Page() {
  return (
    <Suspense>
      <DiscoverScreen />
    </Suspense>
  );
}
