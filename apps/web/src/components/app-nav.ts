export type AppNavKey = "accueil" | "decouvrir" | "articles" | "moi";
export type AppNavItem = { key: AppNavKey; href: string };
/** A place of the phone's bottom bar: a page, or the + in the middle. */
export type PhoneSlot = AppNavItem | { key: "add"; href: null };

/** The four places of the app (refonte Boudoir, spec §2 R2), in this order; the + sits between Découvrir and Mes articles. */
export const appNav: readonly AppNavItem[] = [
  { key: "accueil", href: "/" },
  { key: "decouvrir", href: "/decouvrir" },
  { key: "articles", href: "/articles" },
  { key: "moi", href: "/moi" },
];

/** The action of the menu: « Ajouter un article » (the + on a phone, « + Ajouter » in the band). */
export const addAction = { key: "add", href: null } as const;

/** Phone: Accueil · Découvrir · + · Mes articles · Moi. */
export const phoneNav: readonly PhoneSlot[] = [...appNav.slice(0, 2), addAction, ...appNav.slice(2)];

/** The pages each place covers, with their sub-pages (spec §3.1): what she reaches from it stays marked. */
const SECTIONS: Record<AppNavKey, readonly string[]> = {
  accueil: [],
  decouvrir: ["/decouvrir"],
  articles: ["/articles", "/produits", "/listes", "/envies", "/dressing", "/a-vendre", "/commande"],
  moi: ["/moi", "/reglages", "/aide"],
};

export function isCurrent(item: AppNavItem, pathname: string): boolean {
  if (item.key === "accueil") return pathname === "/";
  return SECTIONS[item.key].some((base) => pathname === base || pathname.startsWith(`${base}/`));
}
