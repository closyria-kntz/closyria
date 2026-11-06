import type { StageCounts } from "@closyria/shared";

export type AppNavItem = {
  key: "home" | "wishes" | "ordered" | "wardrobe" | "forSale" | "lists" | "settings" | "help";
  href: string;
};
export type PhoneTab = AppNavItem | { key: "more"; href: null };

/** The home page (paste a link, recent links), then the six places of the app (spec §4). */
export const desktopNav: readonly AppNavItem[] = [
  { key: "home", href: "/" },
  { key: "wishes", href: "/envies" },
  { key: "ordered", href: "/commande" },
  { key: "wardrobe", href: "/dressing" },
  { key: "forSale", href: "/a-vendre" },
  { key: "lists", href: "/listes" },
  { key: "settings", href: "/reglages/profils" },
];

export const tabletTabs: readonly AppNavItem[] = desktopNav;

/** « Aide »: at the bottom of the side menu, last behind « Plus » on a phone (Passe design §2). */
export const helpNav: AppNavItem = { key: "help", href: "/aide/iphone" };

/** Phone: five tabs; « À vendre », « Listes », « Réglages » and « Aide » live behind « Plus ». */
export const moreNav: readonly AppNavItem[] = [...desktopNav.slice(4), helpNav];
export const phoneTabs: readonly PhoneTab[] = [...desktopNav.slice(0, 4), { key: "more", href: null }];

const section = (item: AppNavItem): string => `/${item.href.split("/")[1]}`;

export function isCurrent(item: AppNavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/";
  const base = section(item);
  return pathname === base || pathname.startsWith(`${base}/`);
}

const STAGE_OF: Partial<Record<AppNavItem["key"], keyof StageCounts>> = {
  wishes: "spotted",
  ordered: "ordered",
  wardrobe: "owned",
  forSale: "for_sale",
};

/** The number shown beside a place of the side menu: its stage's active items, null for the other places. */
export function countFor(item: AppNavItem, counts: StageCounts | null): number | null {
  const stage = STAGE_OF[item.key];
  return stage && counts ? counts[stage] : null;
}
