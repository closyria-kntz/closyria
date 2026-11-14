import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { InvalidLink, ListingShell, listingKickerClass, listingTitleClass } from "@/components/listing-page";
import { internalApiFor } from "@/lib/admin-api";
import { fetchManage } from "@/lib/listing";
import { WithdrawPanel } from "./withdraw-panel";

// The private management link given at acceptance: the shop's status and « Retirer ma boutique de Closyria ». Public
// (the link is the key), never indexed, no referrer sent (next.config.ts).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Listing.manage");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await fetchManage(internalApiFor(await headers(), process.env), token);
  if (!result.ok) return <InvalidLink manage />;
  const t = await getTranslations("Listing.manage");
  return (
    <ListingShell>
      <div className="flex flex-col gap-space-2">
        <span className={listingKickerClass}>{t("kicker")}</span>
        <h1 className={listingTitleClass}>{t("title", { shop: result.data.shopName })}</h1>
      </div>
      <WithdrawPanel token={token} initial={result.data} />
    </ListingShell>
  );
}
