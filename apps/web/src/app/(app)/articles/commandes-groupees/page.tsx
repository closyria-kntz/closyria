import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { GroupOrdersView } from "@/components/group-orders-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Views.groupOrders");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

/** « Mes articles › Commandes groupées » (refonte Boudoir, spec §3.1): her running group orders, one per list. */
export default function Page() {
  return <GroupOrdersView />;
}
