import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { InstagramForm } from "@/components/instagram-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Orders.instagram");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

/** « Coller un lien » with an Instagram link (spec §3.6): the short form, `?lien=` carries the link. */
export default function Page() {
  return (
    <Suspense>
      <InstagramForm />
    </Suspense>
  );
}
