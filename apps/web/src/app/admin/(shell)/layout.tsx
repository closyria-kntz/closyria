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
    <div data-admin-shell className="flex min-h-dvh flex-col bg-surface text-ink">
      <a
        href="#admin-content"
        className={`sr-only rounded-button bg-surface-raised px-space-3 py-space-2 focus:not-sr-only focus:absolute focus:top-space-2 focus:left-space-2 ${focusRing}`}
      >
        {t("shell.skipToContent")}
      </a>
      {/* The menu stays in view while the page scrolls (sticky, opaque): on a phone its one-line row at the top (the
          bar, taller there, scrolls away); on a computer the bar and, under it, the list of the full-height column.
          `data-admin-shell` keeps anchors and focus below them. */}
      <header className="flex shrink-0 items-center justify-between gap-space-4 border-b border-line bg-surface-raised px-space-5 py-space-3 md:sticky md:top-space-0 md:z-30 md:h-space-8 md:py-space-0">
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
          className="sticky top-space-0 z-20 border-b border-line bg-surface-sunken px-space-3 py-space-2 md:static md:z-auto md:border-r md:border-b-0 md:px-space-3 md:py-space-0"
        >
          <AdminNavLinks items={items} />
        </nav>
        <main
          id="admin-content"
          tabIndex={-1}
          className="min-w-space-0 flex-1 px-space-5 py-space-5 focus:outline-none md:px-space-6"
        >
          <div className="mx-auto flex max-w-app flex-col gap-space-5">{children}</div>
        </main>
      </div>
    </div>
  );
}
