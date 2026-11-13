"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { focusRing } from "./ui";

const LINKS = [
  { key: "profiles", href: "/reglages/profils" },
  { key: "tags", href: "/reglages/etiquettes" },
  { key: "levels", href: "/reglages/niveaux" },
  { key: "sizes", href: "/reglages/tailles" },
  { key: "appearance", href: "/reglages/apparence" },
  { key: "trash", href: "/reglages/corbeille" },
  { key: "account", href: "/reglages/compte" },
  { key: "phone", href: "/aide/telephone" },
] as const;

/** Sub-navigation of « Réglages »: profiles, tags, levels, sizes, appearance, trash, her account and the phone help page. */
export function SettingsNav() {
  const t = useTranslations("Settings.nav");
  const pathname = usePathname();
  return (
    <nav aria-label={t("label")}>
      <ul className="flex flex-wrap gap-space-2">
        {LINKS.map((link) => (
          <li key={link.key} className="flex flex-col">
            <Link
              href={link.href}
              aria-current={pathname === link.href ? "page" : undefined}
              className={`flex min-h-touch-target items-center rounded-button border border-line px-space-3 text-sm hover:bg-surface-strong aria-[current=page]:bg-surface-strong aria-[current=page]:font-strong aria-[current=page]:text-accent ${focusRing}`}
            >
              {t(link.key)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
