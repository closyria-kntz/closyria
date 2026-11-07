import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { OrderDraft } from "@/components/order-draft";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Views.metadata");
  return { title: t("order"), robots: { index: false, follow: false } };
}

export default function Page() {
  return (
    <Suspense>
      <OrderDraft />
    </Suspense>
  );
}
