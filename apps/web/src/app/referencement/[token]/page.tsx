import { LISTING_CONDITIONS } from "@closyria/shared";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import {
  ConditionsText,
  InvalidLink,
  ListingShell,
  listingKickerClass,
  listingTitleClass,
} from "@/components/listing-page";
import { internalApiFor } from "@/lib/admin-api";
import { fetchInvitation } from "@/lib/listing";
import { InvitationFlow } from "./invitation-form";

// « Référencer ma boutique » from the admin's invitation link: public, no account, never indexed, no referrer sent
// (next.config.ts). A link that is no longer good shows the same message whatever the reason, without the shop.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Listing.invitation");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await fetchInvitation(internalApiFor(await headers(), process.env), token);
  if (!result.ok) return <InvalidLink />;
  const t = await getTranslations("Listing.invitation");
  const { shop } = result.data;
  return (
    <ListingShell>
      <InvitationFlow
        token={token}
        shopName={shop.name}
        version={LISTING_CONDITIONS.version}
        intro={
          <>
            <div className="flex flex-col gap-space-2">
              <span className={listingKickerClass}>{t("kicker")}</span>
              <h1 className={listingTitleClass}>{t("title", { shop: shop.name })}</h1>
              {shop.domain && <p className="text-chip text-ink-muted">{t("site", { domain: shop.domain })}</p>}
            </div>
            <p>{t("intro")}</p>
          </>
        }
        conditions={<ConditionsText markdown={LISTING_CONDITIONS.markdown} titleId="conditions" />}
      />
    </ListingShell>
  );
}
