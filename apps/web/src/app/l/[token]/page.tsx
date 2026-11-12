import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { focusRing } from "@/components/ui";
import { internalApiFor } from "@/lib/admin-api";
import { fetchSharedList, withGiftsHidden } from "@/lib/shared-list";
import { SharedListView } from "./opinions";

// A shared list: public, no account, no cookies on the server's read. Product data and friends' opinions only (G4);
// gift states come only from the browser's re-read. Never indexed.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("SharedList");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

export default async function SharedListPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("SharedList");
  const tShell = await getTranslations("Shell");
  const result = await fetchSharedList(internalApiFor(await headers(), process.env), token);
  if (!result.ok) notFound();

  const owner = result.data.ownerName;
  return (
    <>
      {/* Boudoir's burgundy band (mockup lienAmies()): the logo, and whose list this is. */}
      <header className="bg-band text-band-ink">
        <div className="mx-auto flex w-full max-w-app items-center gap-space-3 px-space-4 py-space-3 md:px-space-5 lg:px-space-6">
          <Link href="/" className={`font-title text-logo leading-none ${focusRing}`}>
            {tShell("brand")}
          </Link>
          <span className="flex-1" />
          <span className="truncate text-chip text-band-field-ink">
            {owner ? t("band", { name: owner }) : t("metadata")}
          </span>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-app flex-col gap-space-4-5 px-space-4 pt-space-4 pb-space-6 md:px-space-5 md:pt-space-6 lg:px-space-6">
        {/* No gift state in the HTML: the owner herself may open the link (she must never see who offers what). */}
        <SharedListView token={token} initial={withGiftsHidden(result.data)} />
        <footer className="flex flex-col gap-space-1 text-sm text-ink-muted">
          <p>{t("footer")}</p>
          <Link href="/" className={`self-start text-accent underline ${focusRing}`}>
            {t("footerLink")}
          </Link>
        </footer>
      </main>
    </>
  );
}
