"use client";

import type { ProfileView, SummaryView } from "@closyria/shared";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, Suspense, useCallback, useEffect, useId, useRef, useState } from "react";
import { fetchSummary } from "@/lib/catalog-client";
import { ProfilesContext, profileHref, useAccount, useCurrentProfile } from "@/lib/profile-context";
import { AccountPrompt } from "./account-prompt";
import { type AppNavItem, desktopNav, isCurrent, moreNav, phoneTabs, tabletTabs } from "./app-nav";
import { CaptureForm } from "./capture-form";
import { ProfileSwitcher } from "./profile-switcher";
import { buttonClass, focusRing } from "./ui";
import { UndoToast } from "./undo-toast";

const linkShape = `flex min-h-touch-target items-center justify-center rounded-button text-sm hover:bg-surface-strong aria-[current=page]:bg-surface-strong aria-[current=page]:font-strong aria-[current=page]:text-accent ${focusRing}`;
const linkBase = `${linkShape} px-space-3`;
/** Phone tabs: five across the narrowest screens, so almost no side padding. */
const tabBase = `${linkShape} min-w-space-0 px-space-1`;

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

/**
 * Who is signed in, always in sight (bottom of the side menu, end of « Plus »): her e-mail, or « Sans compte ».
 * Opens « Mon compte », where she signs out.
 */
function AccountLink({ className }: { className: string }) {
  const t = useTranslations("Shell.account");
  const pathname = usePathname();
  const account = useAccount();
  const href = "/reglages/compte";
  return (
    <Link href={href} aria-current={pathname === href ? "page" : undefined} className={className}>
      <span className="flex min-w-space-0 flex-col items-start">
        <span>{t("label")}</span>
        {account && <span className="max-w-full truncate text-ink-muted">{account.email ?? t("anonymous")}</span>}
      </span>
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
      className="tabbar-safe relative z-20 shrink-0 border-t border-line bg-surface-raised md:hidden"
    >
      {open && (
        <ul id={panel} aria-label={t("moreMenu")} className="flex flex-col gap-space-1 border-b border-line p-space-2">
          {moreNav.map((item) => (
            <li key={item.key} className="flex flex-col">
              <NavLink item={item} className={`${linkBase} justify-start`} />
            </li>
          ))}
          <li className="flex flex-col">
            <AccountLink className={`${linkBase} justify-start py-space-1`} />
          </li>
        </ul>
      )}
      <ul className="flex">
        {phoneTabs.map((tab) => (
          <li key={tab.key} className="flex min-w-space-0 flex-1 flex-col py-space-1">
            {tab.href === null ? (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panel}
                aria-current={moreCurrent ? "true" : undefined}
                onClick={() => setOpen((value) => !value)}
                className={`${tabBase} flex-1`}
              >
                {t("more")}
              </button>
            ) : (
              <NavLink item={tab} className={`${tabBase} flex-1`} />
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
  const pathname = usePathname();
  const onHome = pathname === "/";
  const content = useRef<HTMLElement>(null);
  // Only the content scrolls (Passe design §1): every new page, and a page reached back, starts at the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on every navigation.
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
  }, [pathname]);
  const [profiles, setProfiles] = useState<readonly ProfileView[]>([]);
  const [account, setAccount] = useState<SummaryView["account"] | null>(null);
  const [ready, setReady] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const alive = useRef(true);

  const refreshProfiles = useCallback(async () => {
    const summary = await fetchSummary();
    if (summary && alive.current) {
      setProfiles(summary.profiles);
      setAccount(summary.account);
    }
    if (alive.current) setReady(true);
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
    <ProfilesContext.Provider value={{ profiles, ready, account, refreshProfiles }}>
      <a
        href="#app-content"
        className={`sr-only rounded-button bg-surface-raised px-space-3 py-space-2 focus:not-sr-only focus:absolute focus:top-space-2 focus:left-space-2 focus:z-30 ${focusRing}`}
      >
        {t("skipToContent")}
      </a>
      <div className="flex h-dvh overflow-hidden bg-surface text-ink">
        <aside className="hidden w-sidebar shrink-0 flex-col gap-space-5 overflow-y-auto border-r border-line bg-surface-sunken p-space-4 lg:flex">
          <Link href="/" className={`font-display text-title font-strong ${focusRing}`}>
            {t("brand")}
          </Link>
          <nav aria-label={t("nav.desktop")} className="flex flex-1 flex-col justify-between gap-space-5">
            <ul className="flex flex-col gap-space-1">
              <Suspense>
                {desktopNav.map((item) => (
                  <li key={item.key} className="flex flex-col">
                    <NavLink item={item} className={`${linkBase} justify-start`} />
                  </li>
                ))}
              </Suspense>
            </ul>
            {/* « Mon compte » at the bottom, still inside the menu's landmark. */}
            <ul className="flex flex-col">
              <li className="flex flex-col">
                <Suspense>
                  <AccountLink className={`${linkBase} justify-start py-space-1`} />
                </Suspense>
              </li>
            </ul>
          </nav>
        </aside>

        <div className="flex min-h-space-0 min-w-space-0 flex-1 flex-col">
          <header className="relative z-10 shrink-0 border-b border-line bg-surface-raised">
            <div className="relative flex items-center justify-between gap-space-3 px-space-4 py-space-2 md:px-space-5">
              <Link href="/" className={`font-display text-lead font-strong lg:invisible ${focusRing}`}>
                {t("brand")}
              </Link>
              <div className="flex items-center gap-space-2">
                <Suspense>
                  <ProfileSwitcher />
                </Suspense>
                {!onHome && <AddLink />}
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
            ref={content}
            id="app-content"
            tabIndex={-1}
            className="relative min-h-space-0 flex-1 overflow-y-auto px-space-4 pt-space-5 pb-space-6 focus:outline-none md:px-space-5 lg:px-space-6"
          >
            <div className="mx-auto flex w-full max-w-app flex-col gap-space-4">
              <Suspense>
                <AccountPrompt />
              </Suspense>
              {children}
            </div>
          </main>
          <Suspense>
            <BottomTabs open={moreOpen} setOpen={setMoreOpen} />
          </Suspense>
        </div>
      </div>
      <UndoToast />
    </ProfilesContext.Provider>
  );
}
