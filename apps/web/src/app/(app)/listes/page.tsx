import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WishlistsView } from "@/components/wishlists-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Lists");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

export default function Page() {
  return <WishlistsView />;
}
