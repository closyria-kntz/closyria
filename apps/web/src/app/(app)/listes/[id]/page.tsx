import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WishlistDetail } from "@/components/wishlist-detail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Lists");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WishlistDetail id={id} />;
}
