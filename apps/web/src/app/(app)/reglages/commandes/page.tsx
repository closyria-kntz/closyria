import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { OrderInboxSettings } from "@/components/order-inbox-settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Orders.inbox");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

/** Compte → « Mes commandes par e-mail » (« Après la commande », spec §3.1). */
export default function Page() {
  return <OrderInboxSettings />;
}
