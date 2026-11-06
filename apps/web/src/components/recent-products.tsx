"use client";

import type { RecentProductView } from "@closyria/shared";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { fetchRecents, forgetRecent } from "@/lib/wardrobe-client";
import { focusRing } from "./ui";

/** Where the focus goes after a ✕: another card's ✕, the heading, or the paste field when the section is gone. */
type FocusTarget = { productId: string } | "heading" | "empty";

/**
 * « Derniers liens »: what she pasted lately and has not kept. Renders nothing without a session, a recent or on error.
 * After a ✕ the focus moves to the next card's ✕, else the previous one; when the last one goes (and the section with
 * it), to the element `emptyFocusId` (the paste field).
 */
export function RecentProducts({ emptyFocusId }: { emptyFocusId?: string }) {
  const t = useTranslations("Home.recents");
  const [recents, setRecents] = useState<RecentProductView[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const forgetButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusAfter = useRef<FocusTarget | null>(null);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once the list without the removed card is rendered.
  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = null;
    if (target === "empty") {
      if (emptyFocusId) document.getElementById(emptyFocusId)?.focus();
    } else if (target === "heading") heading.current?.focus();
    else (forgetButtons.current.get(target.productId) ?? heading.current)?.focus();
  }, [recents, emptyFocusId]);

  if (recents.length === 0) return null;

  const forget = async (productId: string) => {
    const result = await forgetRecent(productId);
    if (!result.ok) return;
    setRecents((current) => {
      const index = current.findIndex((r) => r.product.id === productId);
      const remaining = current.filter((r) => r.product.id !== productId);
      const next = remaining[index] ?? remaining[index - 1];
      focusAfter.current = next ? { productId: next.product.id } : remaining.length === 0 ? "empty" : "heading";
      return remaining;
    });
  };

  return (
    <section aria-labelledby="recents-title" className="w-full text-left">
      <h2
        id="recents-title"
        ref={heading}
        tabIndex={-1}
        className={`mb-space-3 rounded-button font-display text-lead font-strong ${focusRing}`}
      >
        {t("title")}
      </h2>
      <ul className="grid grid-cols-2 gap-space-3 md:grid-cols-4">
        {recents.map(({ product }) => {
          const name = product.name ?? product.shop.name;
          const image = product.images[0];
          return (
            <li key={product.id} className="relative flex flex-col gap-space-1">
              <Link href={`/produits/${product.id}`} className={`flex flex-col gap-space-1 rounded-card ${focusRing}`}>
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
                ref={(button) => {
                  if (button) forgetButtons.current.set(product.id, button);
                  else forgetButtons.current.delete(product.id);
                }}
                aria-label={t("forget", { name })}
                onClick={() => forget(product.id)}
                className={`absolute top-space-1 right-space-1 inline-flex min-h-touch-target min-w-touch-target items-center justify-center rounded-button bg-surface-raised text-ink ${focusRing}`}
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
