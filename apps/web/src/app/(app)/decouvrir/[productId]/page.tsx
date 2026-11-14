import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { getAdminAccess } from "@/app/admin/server";
import { CatalogueSheet } from "./catalogue-sheet";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Discover.sheet");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

type Props = { params: Promise<{ productId: string }> };

/** The sheet of a catalogue article (spec 2026-11-13 §3.2). */
export default async function Page({ params }: Props) {
  const { productId } = await params;
  // Until the shops agree to be listed, the catalogue sheet is for admins only (the API refuses the rest too).
  if ((await getAdminAccess()) !== "ok") notFound();
  if (!z.uuid().safeParse(productId).success) notFound();
  return <CatalogueSheet key={productId} productId={productId} />;
}
