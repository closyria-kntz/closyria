"use client";

import type { ProfileView } from "@closyria/shared";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, Suspense, useEffect, useId, useState } from "react";
import { fetchSummary } from "@/lib/catalog-client";
import { ProfilesContext, profileHref, useCurrentProfile } from "@/lib/profile-context";
import { type AppNavItem, desktopNav, isCurrent, moreNav, phoneTabs, tabletTabs } from "./app-nav";
import { CaptureForm } from "./capture-form";
import { ProfileSwitcher } from "./profile-switcher";
import { buttonClass, focusRing } from "./ui";

const linkBase = `flex min-h-touch-target items-center justify-center rounded-button px-space-3 text-sm hover:bg-surface-strong aria-[current=page]:bg-surface-strong aria-[current=page]:font-strong aria-[current=page]:text-accent ${focusRing}`;

function NavLink({ item, className }: { item: AppNavItem; className: string }) {
  const t = useTranslations("Shell.nav");
  const pathname = usePathname();
  const { id, isDefault } = useCurrentProfile();
  return (
    <Link
      href={profileHref(item.href, id, isDefault)}
      aria-current={isCurrent(item, pathname) ? "page" : undefined}
      className={className}
    >
      {t(item.key)}
    </Link>
  );
}

function BottomTabs() {
  const t = useTranslations("Shell.nav");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panel = useId();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the « Plus » panel closes on every navigation.
  useEffect(() => setOpen(false), [pathname]);
  const moreCurrent = moreNav.some((item) => isCurrent(item, pathname));
  return (
    <nav
      aria-label={t("tabs")}
      data-testid="app-nav-bottom"
      className="fixed inset-x-space-0 bottom-space-0 z-20 border-t border-line bg-surface-raised md:hidden"
    >
      {open && (
        <ul id={panel} aria-label={t("moreMenu")} className="flex flex-col gap-space-1 border-b border-line p-space-2">
          {moreNav.map((item) => (
            <li key={item.key} className="flex flex-col">
              <NavLink item={item} className={`${linkBase} justify-start`} />
            </li>
          ))}
        </ul>
      )}
      <ul className="flex">
        {phoneTabs.map((tab) => (
          <li key={tab.key} className="flex flex-1 flex-col p-space-1">
            {tab.href === null ? (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panel}
                aria-current={moreCurrent ? "true" : undefined}
                onClick={() => setOpen((value) => !value)}
                className={`${linkBase} flex-1`}
              >
                {t("more")}
              </button>
            ) : (
              <NavLink item={tab} className={`${linkBase} flex-1`} />
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

function AddLink() {
  const t = useTranslations("Shell.add");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panel = useId();
  // biome-ignore lint/correctness/useExhaustiveDependencies: opening a sheet closes the field.
  useEffect(() => setOpen(false), [pathname]);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-touch-target items-center justify-center rounded-button bg-button-bg px-space-4 text-sm font-strong text-button-ink"
      >
        {t("open")}
      </button>
      {open && (
        <div
          id={panel}
          className="absolute inset-x-space-0 top-full border-b border-line bg-surface-raised px-space-4 py-space-4 shadow-lifted"
        >
          <div className="mx-auto flex max-w-measure flex-col items-end gap-space-2">
            <CaptureForm />
            <button type="button" className={buttonClass} onClick={() => setOpen(false)}>
              {t("close")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The adaptive frame of the signed-in pages (spec §4): tab bar at the bottom on a phone, tabs at the top on a
 * tablet, side menu on a desktop. Content grows up to `container.app`.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations("Shell");
  const [profiles, setProfiles] = useState<readonly ProfileView[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetchSummary(undefined, controller.signal).then((summary) => {
      if (summary && !controller.signal.aborted) setProfiles(summary.profiles);
    });
    return () => controller.abort();
  }, []);

  return (
    <ProfilesContext.Provider value={profiles}>
      <div className="flex min-h-dvh bg-surface text-ink">
        <aside className="sticky top-space-0 hidden h-dvh w-sidebar shrink-0 flex-col gap-space-5 border-r border-line bg-surface-sunken p-space-4 lg:flex">
          <Link href="/" className={`font-display text-title font-strong ${focusRing}`}>
            {t("brand")}
          </Link>
          <nav aria-label={t("nav.desktop")}>
            <ul className="flex flex-col gap-space-1">
              <Suspense>
                {desktopNav.map((item) => (
                  <li key={item.key} className="flex flex-col">
                    <NavLink item={item} className={`${linkBase} justify-start`} />
                  </li>
                ))}
              </Suspense>
            </ul>
          </nav>
        </aside>

        <div className="flex min-w-space-0 flex-1 flex-col">
          <header className="sticky top-space-0 z-10 border-b border-line bg-surface-raised">
            <div className="relative flex items-center justify-between gap-space-3 px-space-4 py-space-2 md:px-space-5">
              <Link href="/" className={`font-display text-lead font-strong lg:invisible ${focusRing}`}>
                {t("brand")}
              </Link>
              <div className="flex items-center gap-space-2">
                <Suspense>
                  <ProfileSwitcher />
                </Suspense>
                <AddLink />
              </div>
            </div>
            <nav
              aria-label={t("nav.tabs")}
              data-testid="app-nav-top"
              className="hidden border-t border-line px-space-4 md:block lg:hidden"
            >
              <ul className="flex gap-space-1 py-space-1">
                <Suspense>
                  {tabletTabs.map((item) => (
                    <li key={item.key} className="flex flex-col">
                      <NavLink item={item} className={linkBase} />
                    </li>
                  ))}
                </Suspense>
              </ul>
            </nav>
          </header>

          <main className="flex-1 px-space-4 pt-space-5 pb-space-8 md:px-space-5 md:pb-space-6 lg:px-space-6">
            <div className="mx-auto w-full max-w-app">{children}</div>
          </main>
        </div>
      </div>
      <Suspense>
        <BottomTabs />
      </Suspense>
    </ProfilesContext.Provider>
  );
}
