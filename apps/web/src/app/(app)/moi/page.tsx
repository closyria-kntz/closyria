import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { MeHeader, MeScreen } from "@/components/me-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Me");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

/** « Moi » (refonte Boudoir, spec R6): her tiles, the return dates to come, « Mon dressing » and all her pages. */
export default function Page() {
  return (
    <div className="flex flex-col gap-space-4-5">
      <MeHeader />
      <Suspense>
        <MeScreen />
      </Suspense>
    </div>
  );
}
