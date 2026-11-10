import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { GroupOrderView } from "@/components/group-order-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("GroupOrder");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GroupOrderView listId={id} />;
}
