"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ARTICLES_PATH } from "@/lib/articles-address";
import { profileHref, useAccount, useCurrentProfile } from "@/lib/profile-context";
import { focusRing } from "./ui";

/** Everything the old « Plus » menu and the old tabs gave, from « Moi » (each link keeps the chosen profile). */
const PLACES = [
  { key: "envies", href: `${ARTICLES_PATH}?etape=envie` },
  { key: "commande", href: `${ARTICLES_PATH}?etape=commande` },
  { key: "dressing", href: `${ARTICLES_PATH}?etape=dressing` },
  { key: "aVendre", href: `${ARTICLES_PATH}?etape=a-vendre` },
  { key: "listes", href: "/listes" },
  { key: "budget", href: `${ARTICLES_PATH}?etape=envie` },
  { key: "reglages", href: "/reglages/profils" },
  { key: "compte", href: "/reglages/compte" },
  { key: "aide", href: "/aide/telephone" },
] as const;

const rowClass = `flex min-h-touch-target items-center justify-between gap-space-3 rounded-card bg-surface-raised px-space-4 py-space-3 font-strong hover:bg-surface-strong ${focusRing}`;

export function MePlaces() {
  const t = useTranslations("Me");
  const tAccount = useTranslations("Shell.account");
  const account = useAccount();
  const { id, isDefault } = useCurrentProfile();
  return (
    <nav aria-label={t("placesLabel")}>
      <ul className="flex flex-col gap-space-2">
        {PLACES.map((place) => (
          <li key={place.key} className="flex flex-col">
            <Link
              href={place.key === "compte" ? place.href : profileHref(place.href, id, isDefault)}
              className={rowClass}
            >
              <span>{t(`places.${place.key}`)}</span>
              {place.key === "compte" && account && (
                <span className="truncate text-sm font-regular text-ink-muted">
                  {account.email ?? tAccount("anonymous")}
                </span>
              )}
              {place.key === "budget" && (
                <span className="text-sm font-regular text-ink-muted">{t("budgetWhere")}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
