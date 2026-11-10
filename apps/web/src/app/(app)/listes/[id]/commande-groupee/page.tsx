import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { GroupOrderView } from "@/components/group-order-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("GroupOrder");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ commande?: string | string[] }>;
}) {
  const { id } = await params;
  // `?commande=<id>`: a past one, opened from « Commandes groupées passées ».
  const { commande } = await searchParams;
  return <GroupOrderView listId={id} orderId={typeof commande === "string" ? commande : null} />;
}
