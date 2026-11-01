import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { AdminNavLinks } from "../admin-nav";
import { CommandPalette } from "../command-palette";
import { adminNav } from "../nav";
import { getAdminAccess } from "../server";
import { ThemeToggle } from "../theme-toggle";
import { focusRing } from "../ui";

/** The admin shell: only for an admin signed in with a passkey (spec §8). */
export default async function AdminShellLayout({ children }: { children: ReactNode }) {
  // Next renders nested layouts concurrently: repeat the 404 here so a non-admin never sees the redirect target.
  const access = await getAdminAccess();
  if (access === "not-found") notFound();
  if (access === "passkey-required") redirect("/admin/passkey-required");
  const t = await getTranslations("Admin");
  const items = adminNav.map((item) => ({ ...item, label: t(`nav.${item.key}`) }));

  return (
    <div className="flex min-h-dvh flex-col bg-surface text-ink">
      <a
        href="#admin-content"
        className={`sr-only rounded-button bg-surface-raised px-space-3 py-space-2 focus:not-sr-only focus:absolute focus:top-space-2 focus:left-space-2 ${focusRing}`}
      >
        {t("shell.skipToContent")}
      </a>
      <header className="flex items-center justify-between gap-space-4 border-b border-line bg-surface-raised px-space-5 py-space-3">
        <p className="font-display text-lead font-strong">{t("shell.title")}</p>
        <div className="flex items-center gap-space-2">
          <CommandPalette
            items={items.map(({ href, label }) => ({ href, label }))}
            labels={{
              open: t("palette.open"),
              shortcut: t("palette.shortcut"),
              label: t("palette.label"),
              placeholder: t("palette.placeholder"),
              empty: t("palette.empty"),
              navigation: t("palette.navigation"),
            }}
          />
          <ThemeToggle />
        </div>
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        <nav
          aria-label={t("shell.navLabel")}
          className="border-b border-line bg-surface-sunken p-space-3 md:border-r md:border-b-0"
        >
          <AdminNavLinks items={items} />
        </nav>
        <main id="admin-content" tabIndex={-1} className="flex-1 px-space-5 py-space-5 focus:outline-none">
          <div className="mx-auto flex max-w-wide flex-col gap-space-5">{children}</div>
        </main>
      </div>
    </div>
  );
}
