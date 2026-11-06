"use client";

import type { StageCounts } from "@closyria/shared";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { profileHref, useCurrentProfile, useStageCounts } from "@/lib/profile-context";
import { focusRing } from "./ui";

const PLACES: readonly {
  key: "ordered" | "wishes" | "wardrobe" | "forSale";
  href: string;
  stage: keyof StageCounts;
}[] = [
  { key: "ordered", href: "/commande", stage: "ordered" },
  { key: "wishes", href: "/envies", stage: "spotted" },
  { key: "wardrobe", href: "/dressing", stage: "owned" },
  { key: "forSale", href: "/a-vendre", stage: "for_sale" },
];

/**
 * Her wardrobe at a glance, under the paste field (Passe design §4): four links with the current profile's counts,
 * shown at zero too. Nothing until the counts are read, so no false zero.
 */
export function HomeSummary() {
  const t = useTranslations("Home.summary");
  const counts = useStageCounts();
  const { id, isDefault } = useCurrentProfile();
  if (!counts) return null;
  return (
    <nav aria-label={t("title")}>
      <ul className="grid grid-cols-2 gap-space-3 md:grid-cols-4">
        {PLACES.map((place) => (
          <li key={place.key} className="flex">
            <Link
              href={profileHref(place.href, id, isDefault)}
              className={`flex w-full flex-col gap-space-1 rounded-card border border-line bg-surface-raised p-space-4 hover:bg-surface-strong ${focusRing}`}
            >
              <span className="font-display text-title font-strong tabular-nums">{counts[place.stage]}</span>{" "}
              <span className="text-sm">{t(place.key, { count: counts[place.stage] })}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
