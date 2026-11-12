import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AccountHub } from "@/components/account-hub";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AccountHub");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

/** « Compte » (navigation 2026-11-12): her profile, the family's profiles, appearance, settings and help. */
export default function Page() {
  return (
    <Suspense>
      <AccountHub />
    </Suspense>
  );
}
