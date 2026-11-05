import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { ProductView } from "./product-view";
import { viewKey } from "./view-key";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Capture");
  return { title: t("product.metadataTitle"), robots: { index: false, follow: false } };
}

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ capture?: string | string[] }> };

/** A product sheet. `?capture=<id>` (from the paste form or the share target) is the capture to follow. */
export default async function ProductPage({ params, searchParams }: Props) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { capture } = await searchParams;
  const captureId = z.uuid().safeParse(Array.isArray(capture) ? capture[0] : capture);
  return (
    <ProductView
      key={viewKey(id, captureId.success ? captureId.data : null)}
      productId={id}
      captureId={captureId.success ? captureId.data : null}
    />
  );
}
