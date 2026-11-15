import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { OrdersScreen } from "@/components/orders-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Orders.page");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

/** « Mes commandes » (« Après la commande », spec §3.2–3.5): to validate, then her orders and their parcels. */
export default function Page() {
  return (
    <Suspense>
      <OrdersScreen />
    </Suspense>
  );
}
