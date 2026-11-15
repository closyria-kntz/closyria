import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { BareItemView } from "./bare-item-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Capture");
  return { title: t("product.metadataTitle"), robots: { index: false, follow: false } };
}

type Props = { params: Promise<{ id: string }> };

/**
 * The sheet of one of her articles by its id: an article without a product (born from an order line or an Instagram
 * link) shows here; one with a product goes to its product sheet.
 */
export default async function ItemPage({ params }: Props) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return <BareItemView key={id} itemId={id} />;
}
