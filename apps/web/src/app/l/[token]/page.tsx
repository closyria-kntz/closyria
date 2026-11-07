import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalApiFor } from "@/lib/admin-api";
import { fetchSharedList } from "@/lib/shared-list";
import { SharedListView } from "./opinions";

// A shared list: public, no account, no cookies. Product data and friends' opinions only (G4); never indexed.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("SharedList");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

export default async function SharedListPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("SharedList");
  const result = await fetchSharedList(internalApiFor(await headers(), process.env), token);
  if (!result.ok) notFound();

  return (
    <main className="mx-auto flex w-full max-w-app flex-col gap-space-5 px-space-4 py-space-6 md:px-space-5 lg:px-space-6">
      <SharedListView token={token} initial={result.data} />
      <footer className="flex flex-col gap-space-1 text-sm text-ink-muted">
        <p>{t("footer")}</p>
        <Link href="/" className="text-accent underline">
          {t("footerLink")}
        </Link>
      </footer>
    </main>
  );
}
