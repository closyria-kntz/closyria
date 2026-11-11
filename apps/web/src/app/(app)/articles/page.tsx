import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { WardrobeView } from "@/components/wardrobe-view";
import { articlesView } from "@/lib/articles-address";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The first value of each parameter, as the browser's `URLSearchParams.get` reads it. */
async function paramsOf(searchParams: Props["searchParams"]): Promise<URLSearchParams> {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(await searchParams)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) params.set(name, first);
  }
  return params;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const t = await getTranslations("Views.metadata");
  return { title: t(articlesView(await paramsOf(searchParams))), robots: { index: false, follow: false } };
}

/** « Mes articles » (refonte Boudoir): « Tout », or the view of the step in the address (`?etape=`). */
export default async function Page({ searchParams }: Props) {
  const view = articlesView(await paramsOf(searchParams));
  return (
    <Suspense>
      <WardrobeView key={view} view={view} />
    </Suspense>
  );
}
