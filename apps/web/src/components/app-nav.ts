export type AppNavItem = { key: "wishes" | "ordered" | "wardrobe" | "forSale" | "lists" | "settings"; href: string };
export type PhoneTab = AppNavItem | { key: "more"; href: null };

/** The six places of the app (spec §4). The pages arrive with later tasks. */
export const desktopNav: readonly AppNavItem[] = [
  { key: "wishes", href: "/envies" },
  { key: "ordered", href: "/commande" },
  { key: "wardrobe", href: "/dressing" },
  { key: "forSale", href: "/a-vendre" },
  { key: "lists", href: "/listes" },
  { key: "settings", href: "/reglages/profils" },
];

export const tabletTabs: readonly AppNavItem[] = desktopNav;

/** Phone: four tabs; « À vendre », « Listes » and « Réglages » live behind « Plus ». */
export const moreNav: readonly AppNavItem[] = desktopNav.slice(3);
export const phoneTabs: readonly PhoneTab[] = [...desktopNav.slice(0, 3), { key: "more", href: null }];

const section = (item: AppNavItem): string => `/${item.href.split("/")[1]}`;

export function isCurrent(item: AppNavItem, pathname: string): boolean {
  const base = section(item);
  return pathname === base || pathname.startsWith(`${base}/`);
}
