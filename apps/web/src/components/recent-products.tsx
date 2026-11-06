"use client";

import type { RecentProductView } from "@closyria/shared";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { fetchRecents, forgetRecent } from "@/lib/wardrobe-client";

/** « Derniers liens »: what she pasted lately and has not kept. Renders nothing without a session, a recent or on error. */
export function RecentProducts() {
  const t = useTranslations("Home.recents");
  const [recents, setRecents] = useState<RecentProductView[]>([]);

  useEffect(() => {
    let alive = true;
    fetchRecents().then(
      (list) => alive && setRecents(list?.recents ?? []),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, []);

  if (recents.length === 0) return null;

  const forget = async (productId: string) => {
    const result = await forgetRecent(productId);
    if (result.ok) setRecents((current) => current.filter((r) => r.product.id !== productId));
  };

  return (
    <section aria-labelledby="recents-title" className="w-full text-left">
      <h2 id="recents-title" className="mb-space-3 font-display text-lead font-strong">
        {t("title")}
      </h2>
      <ul className="grid grid-cols-2 gap-space-3 md:grid-cols-4">
        {recents.map(({ product }) => {
          const name = product.name ?? product.shop.name;
          const image = product.images[0];
          return (
            <li key={product.id} className="relative flex flex-col gap-space-1">
              <Link
                href={`/produits/${product.id}`}
                className="flex flex-col gap-space-1 rounded-card focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <div className="aspect-3/4 overflow-hidden rounded-card bg-media-backdrop">
                  {image && (
                    // biome-ignore lint/performance/noImgElement: photos come from our own /api/catalog-images, sized by the API.
                    <img
                      src={image.url}
                      width={image.width}
                      height={image.height}
                      alt=""
                      loading="lazy"
                      className="size-full object-contain"
                    />
                  )}
                </div>
                <span className="text-sm text-ink-muted">{product.shop.name}</span>
                <span className="text-sm font-strong">{name}</span>
              </Link>
              <button
                type="button"
                aria-label={t("forget", { name })}
                onClick={() => forget(product.id)}
                className="absolute top-space-1 right-space-1 inline-flex min-h-touch-target min-w-touch-target items-center justify-center rounded-button bg-surface-raised text-ink focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
