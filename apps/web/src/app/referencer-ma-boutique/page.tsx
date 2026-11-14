import { LISTING_CONDITIONS } from "@closyria/shared";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ConditionsText, ListingShell, listingTitleClass } from "@/components/listing-page";
import { RequestForm } from "./request-form";

// « Référencer ma boutique » for a shop Closyria did not invite (linked from « Vous êtes une boutique ? » in
// « Découvrir »): a request the admin decides on, after checking that the person represents the shop.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Listing.request");
  return { title: t("metadata") };
}

export default async function RequestPage() {
  const t = await getTranslations("Listing.request");
  return (
    <ListingShell>
      <h1 className={listingTitleClass}>{t("title")}</h1>
      <p>{t("intro")}</p>
      <ConditionsText markdown={LISTING_CONDITIONS.markdown} titleId="conditions" />
      <RequestForm version={LISTING_CONDITIONS.version} />
    </ListingShell>
  );
}
