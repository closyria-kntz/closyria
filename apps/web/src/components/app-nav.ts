export type AppNavItem = {
  key: "home" | "wishes" | "ordered" | "wardrobe" | "forSale" | "lists" | "settings";
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

/** Phone: five tabs; « À vendre », « Listes » and « Réglages » live behind « Plus ». */
export const moreNav: readonly AppNavItem[] = desktopNav.slice(4);
export const phoneTabs: readonly PhoneTab[] = [...desktopNav.slice(0, 4), { key: "more", href: null }];

const section = (item: AppNavItem): string => `/${item.href.split("/")[1]}`;

export function isCurrent(item: AppNavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/";
  const base = section(item);
  return pathname === base || pathname.startsWith(`${base}/`);
}
