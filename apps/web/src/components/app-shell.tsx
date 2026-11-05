"use client";

import type { ProfileView } from "@closyria/shared";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, Suspense, useCallback, useEffect, useId, useRef, useState } from "react";
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

function BottomTabs({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (open: boolean | ((open: boolean) => boolean)) => void;
}) {
  const t = useTranslations("Shell.nav");
  const pathname = usePathname();
  const panel = useId();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the « Plus » panel closes on every navigation.
  useEffect(() => setOpen(false), [pathname]);
  const moreCurrent = moreNav.some((item) => isCurrent(item, pathname));
  return (
    <nav
      aria-label={t("tabs")}
      data-testid="app-nav-bottom"
      className="tabbar-safe fixed inset-x-space-0 bottom-space-0 z-20 border-t border-line bg-surface-raised md:hidden"
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
  const button = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: opening a sheet closes the field.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (open) field.current?.querySelector("input")?.focus();
  }, [open]);
  const close = useCallback(() => {
    setOpen(false);
    button.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);
  return (
    <>
      <button
        ref={button}
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
          ref={field}
          className="absolute inset-x-space-0 top-full border-b border-line bg-surface-raised px-space-4 py-space-4 shadow-lifted"
        >
          <div className="mx-auto flex max-w-measure flex-col items-end gap-space-2">
            <CaptureForm />
            <button type="button" className={buttonClass} onClick={close}>
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
  const [moreOpen, setMoreOpen] = useState(false);
  const alive = useRef(true);

  const refreshProfiles = useCallback(async () => {
    const summary = await fetchSummary();
    if (summary && alive.current) setProfiles(summary.profiles);
  }, []);

  // Read on arrival, and again whenever the window regains focus (profiles may have changed in another tab).
  useEffect(() => {
    alive.current = true;
    void refreshProfiles();
    window.addEventListener("focus", refreshProfiles);
    return () => {
      alive.current = false;
      window.removeEventListener("focus", refreshProfiles);
    };
  }, [refreshProfiles]);

  return (
    <ProfilesContext.Provider value={{ profiles, refreshProfiles }}>
      <a
        href="#app-content"
        className={`sr-only rounded-button bg-surface-raised px-space-3 py-space-2 focus:not-sr-only focus:absolute focus:top-space-2 focus:left-space-2 focus:z-30 ${focusRing}`}
      >
        {t("skipToContent")}
      </a>
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

          <main
            id="app-content"
            tabIndex={-1}
            className={`flex-1 px-space-4 pt-space-5 focus:outline-none md:px-space-5 md:pb-space-6 lg:px-space-6 ${moreOpen ? "tabbar-clearance-open" : "tabbar-clearance"}`}
          >
            <div className="mx-auto w-full max-w-app">{children}</div>
          </main>
        </div>
      </div>
      <Suspense>
        <BottomTabs open={moreOpen} setOpen={setMoreOpen} />
      </Suspense>
    </ProfilesContext.Provider>
  );
}
