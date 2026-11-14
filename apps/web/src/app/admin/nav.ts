import type { Messages } from "@closyria/i18n";

export type AdminNavKey = keyof Messages["Admin"]["nav"];

/** An entry of the admin menu and of the ⌘K palette. Its label is `Admin.nav.<key>`. */
export type AdminNavItem = { key: AdminNavKey; href: `/admin${string}` };

/** The admin menu. Each chantier adds its screens here (and their labels under `Admin.nav`). */
export const adminNav = [
  { key: "dashboard", href: "/admin" },
  { key: "users", href: "/admin/utilisatrices" },
  { key: "shops", href: "/admin/boutiques" },
  { key: "captures", href: "/admin/captures" },
  { key: "products", href: "/admin/fiches" },
  { key: "reference", href: "/admin/references" },
  { key: "unclassified", href: "/admin/catalogue/a-classer" },
  { key: "reports", href: "/admin/catalogue/signalements" },
  { key: "sales", href: "/admin/soldes" },
  { key: "audit", href: "/admin/audit" },
] as const satisfies readonly AdminNavItem[];

/** True when `pathname` is this entry's page (the dashboard matches itself only). */
export function isActive(item: AdminNavItem, pathname: string): boolean {
  return item.href === "/admin"
    ? pathname === "/admin"
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
