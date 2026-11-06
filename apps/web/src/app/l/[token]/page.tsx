import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { internalApiFor } from "@/lib/admin-api";
import { formatOptionalPrice } from "@/lib/price";
import { fetchSharedList } from "@/lib/shared-list";
import { CoverPhoto } from "./cover-photo";

// A shared list: public, no account, no cookies. Product data only (G4); never indexed.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("SharedList");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

export default async function SharedListPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("SharedList");
  const locale = await getLocale();
  const result = await fetchSharedList(internalApiFor(await headers(), process.env), token);
  if (!result.ok) notFound();
  const list = result.data;

  return (
    <main className="mx-auto flex w-full max-w-app flex-col gap-space-5 px-space-4 py-space-6 md:px-space-5 lg:px-space-6">
      <header className="flex flex-col gap-space-2">
        <p className="font-display text-lead font-strong text-accent">{t("footerLink")}</p>
        <h1 className="font-display text-title font-strong">{list.name}</h1>
      </header>
      {list.items.length === 0 ? (
        <p className="text-ink-muted">{t("empty")}</p>
      ) : (
        <ul
          aria-label={t("itemsLabel")}
          data-testid="shared-items"
          className="grid grid-cols-2 gap-x-space-3 gap-y-space-5 md:grid-cols-3 lg:grid-cols-5 lg:gap-x-space-4"
        >
          {list.items.map((item) => {
            const name = item.name?.trim() || t("noName");
            return (
              <li key={`${item.url}:${item.name}`} className="card flex flex-col gap-space-2">
                <div className="relative aspect-3/4 overflow-hidden rounded-card bg-media-backdrop">
                  {item.imageUrl && item.imageWidth && item.imageHeight ? (
                    <CoverPhoto
                      photos={[{ url: item.imageUrl, width: item.imageWidth, height: item.imageHeight }]}
                      name={name}
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex size-full items-center justify-center p-space-3 text-center text-sm text-ink-muted"
                    >
                      {t("noPhoto")}
                    </span>
                  )}
                </div>
                <div className="flex min-w-space-0 flex-col px-space-1">
                  <span className="truncate text-sm font-strong">{name}</span>
                  {item.brand && <span className="truncate text-sm text-ink-muted">{item.brand}</span>}
                  <span className="text-sm">
                    {formatOptionalPrice(locale, item.priceCents, item.currency ?? "EUR", t("noPrice"))}
                  </span>
                </div>
                {isHttpUrl(item.url) && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex min-h-touch-target items-center justify-center rounded-button border border-line bg-surface-raised px-space-3 text-sm hover:bg-surface-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline-solid"
                  >
                    {t("visit", { shop: item.shopName })}
                    <span className="sr-only"> — {t("visitFor", { name })}</span>
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <footer className="flex flex-col gap-space-1 text-sm text-ink-muted">
        <p>{t("footer")}</p>
        <Link href="/" className="text-accent underline">
          {t("footerLink")}
        </Link>
      </footer>
    </main>
  );
}
