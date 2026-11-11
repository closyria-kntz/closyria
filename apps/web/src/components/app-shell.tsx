"use client";

import { DEFAULT_LOVE_LEVELS, type LoveLevelView, type ProfileView, type SummaryView } from "@closyria/shared";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { AddSheetContext } from "@/lib/add-sheet-context";
import { ARTICLES_PATH } from "@/lib/articles-address";
import { fetchSummary } from "@/lib/catalog-client";
import { useChangesPoller, useLiveRefresh } from "@/lib/live-changes";
import {
  discoveryShown,
  PreferencesContext,
  type PreferencesContextValue,
  type PreferencesState,
  withSeenTip,
} from "@/lib/preferences";
import { ProfilesContext, profileHref, useAccount, useCurrentProfile } from "@/lib/profile-context";
import { fetchLoveLevels, fetchPreferences, savePreferences } from "@/lib/wardrobe-client";
import { AccountPrompt } from "./account-prompt";
import { AddSheet } from "./add-sheet";
import { type AppNavItem, type AppNavKey, appNav, isCurrent, phoneNav } from "./app-nav";
import { GiftWarning } from "./gift-warning";
import { Onboarding } from "./onboarding";
import { ProfileSwitcher } from "./profile-switcher";
import { focusRing } from "./ui";
import { UndoToast } from "./undo-toast";

/** A place of the band (mockup .links): quiet on the burgundy, the current one a powder-pink pill. */
const topLink = `relative hit-area flex h-control-xs items-center rounded-pill px-space-3 text-menu font-strong text-band-ink hover:bg-band-field aria-[current=page]:bg-band-tab-on aria-[current=page]:text-band-tab-on-ink ${focusRing}`;
/** A place of the phone's bottom bar (mockup .bnav): icon over the name, the current one in the accent. */
const tabLink = `flex min-h-touch-target min-w-space-0 flex-col items-center justify-end gap-space-1 rounded-button text-tab font-strong text-ink-muted aria-[current=page]:text-accent ${focusRing}`;

function useHref(href: string): string {
  const { id, isDefault } = useCurrentProfile();
  return profileHref(href, id, isDefault);
}

/** Line icons of the bottom bar, filled for the current place. */
function TabIcon({ name }: { name: AppNavKey }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-nav-icon fill-none group-aria-[current=page]:fill-current"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "accueil" && <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />}
      {name === "decouvrir" && <path d="M12 3l2.4 5.6L20 11l-5.6 2.4L12 19l-2.4-5.6L4 11l5.6-2.4z" />}
      {name === "articles" && (
        <>
          <rect x="4" y="4" width="7" height="7" rx="2" />
          <rect x="13" y="4" width="7" height="7" rx="2" />
          <rect x="4" y="13" width="7" height="7" rx="2" />
          <rect x="13" y="13" width="7" height="7" rx="2" />
        </>
      )}
      {name === "moi" && (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" />
        </>
      )}
    </svg>
  );
}

function NavLink({ item, variant }: { item: AppNavItem; variant: "top" | "tab" }) {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  const href = useHref(item.href);
  return (
    <Link
      href={href}
      aria-current={isCurrent(item, pathname) ? "page" : undefined}
      className={variant === "top" ? topLink : `group ${tabLink}`}
    >
      {variant === "tab" && <TabIcon name={item.key} />}
      {t(item.key)}
    </Link>
  );
}

/** From a tablet up: the four places in the band, next to the logo (mockup .hdr .links). */
function TopNav() {
  const t = useTranslations("Nav");
  return (
    <nav aria-label={t("label")} data-testid="app-nav-top" className="hidden md:block">
      <ul className="flex items-center gap-space-1-5">
        {appNav.map((item) => (
          <li key={item.key} className="flex">
            <NavLink item={item} variant="top" />
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Phone: Accueil · Découvrir · + · Mes articles · Moi at the bottom, the + raised above the bar (mockup .bnav). */
function BottomNav({ onAdd }: { onAdd: () => void }) {
  const t = useTranslations("Nav");
  return (
    <nav
      aria-label={t("label")}
      data-testid="app-nav-bottom"
      className="tabbar-safe relative z-20 shrink-0 bg-nav md:hidden"
    >
      <ul className="grid grid-cols-5 items-end px-space-1-5 pt-space-2 pb-space-4">
        {phoneNav.map((slot) => (
          <li key={slot.key} className="flex min-w-space-0 flex-col">
            {slot.href === null ? (
              <button type="button" onClick={onAdd} className={tabLink}>
                <span
                  data-plus
                  aria-hidden="true"
                  className="-mt-space-5-5 grid size-plus place-items-center rounded-full bg-accent font-regular text-plus text-accent-ink shadow-plus"
                >
                  +
                </span>
                <span aria-hidden="true">{t("add")}</span>
                <span className="sr-only">{t("addLabel")}</span>
              </button>
            ) : (
              <NavLink item={slot} variant="tab" />
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The band's search (computer, mockup .srch): her articles whose name, brand or shop has the words. */
function BandSearch() {
  const t = useTranslations("Nav.search");
  const router = useRouter();
  const id = useId();
  const base = useHref(ARTICLES_PATH);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const words = new FormData(event.currentTarget).get("recherche");
    const q = typeof words === "string" ? words.trim() : "";
    if (!q) return;
    router.push(`${base}${base.includes("?") ? "&" : "?"}recherche=${encodeURIComponent(q)}`);
  };
  return (
    // A `<search>` element would be found by the views' own search (`locator("search")`): the role says the same.
    // biome-ignore lint/a11y/useSemanticElements: see above.
    <div role="search" className="hidden lg:block">
      <form onSubmit={submit}>
        {/* The label wraps the field and spreads under it out to a finger's reach (`hit-area-under`). */}
        <label htmlFor={id} className="relative isolate block hit-area-under">
          <span className="sr-only">{t("label")}</span>
          <input
            id={id}
            name="recherche"
            type="search"
            placeholder={t("placeholder")}
            className={`h-control-xs min-w-search rounded-pill bg-band-field px-space-3-5 text-caption text-band-ink placeholder:text-band-field-ink ${focusRing}`}
          />
        </label>
      </form>
    </div>
  );
}

/** Her initial in the band (mockup .avatar): opens « Mon compte », and says who is signed in. */
function Avatar() {
  const t = useTranslations("Nav");
  const tAccount = useTranslations("Shell.account");
  const account = useAccount();
  const { profile } = useCurrentProfile();
  const pathname = usePathname();
  const href = "/reglages/compte";
  const initial = (account?.email ?? profile?.name ?? t("moi")).charAt(0).toUpperCase();
  return (
    <Link
      href={href}
      aria-current={pathname === href ? "page" : undefined}
      className={`relative hit-area grid size-control-2xs shrink-0 place-items-center rounded-full bg-une font-bold text-avatar-ink ${focusRing}`}
    >
      <span aria-hidden="true">{initial}</span>
      <span className="sr-only">{t("account", { who: account?.email ?? tAccount("anonymous") })}</span>
    </Link>
  );
}

/**
 * The frame of the signed-in pages (refonte Boudoir, spec §2 R2): a burgundy band at the top with the logo and her
 * initial; one menu, at the bottom on a phone (with the raised +), in the band from a tablet up (with « + Ajouter »).
 * Content grows up to `container.app`.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations("Shell");
  const tNav = useTranslations("Nav");
  const pathname = usePathname();
  const content = useRef<HTMLElement>(null);
  // Only the content scrolls (Passe design §1): every new page, and a page reached back, starts at the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on every navigation.
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
  }, [pathname]);
  const [profiles, setProfiles] = useState<readonly ProfileView[]>([]);
  const [account, setAccount] = useState<SummaryView["account"] | null>(null);
  const [ready, setReady] = useState(false);
  const [adding, setAdding] = useState(false);
  const openAdd = useCallback(() => setAdding(true), []);
  const closeAdd = useCallback(() => setAdding(false), []);
  const [loveLevels, setLoveLevels] = useState<readonly LoveLevelView[]>(DEFAULT_LOVE_LEVELS);
  const alive = useRef(true);

  const [preferences, setPreferences] = useState<PreferencesState>({ status: "loading" });

  // Her closed tips and the discovery: read with the summary (a sign-in elsewhere changes both).
  const refreshPreferences = useCallback(async () => {
    const view = await fetchPreferences().catch(() => undefined);
    if (view !== undefined && alive.current) setPreferences({ status: "ready", view });
  }, []);

  const refreshProfiles = useCallback(async () => {
    const summary = await fetchSummary();
    if (summary && alive.current) {
      setProfiles(summary.profiles);
      setAccount(summary.account);
    }
    if (alive.current) setReady(true);
  }, []);

  const preferencesValue = useMemo<PreferencesContextValue>(
    () => ({
      state: preferences,
      closeTip: (id) => {
        // Gone at once; her account keeps it closed (a failed save only brings it back on the next visit).
        setPreferences((current) => ({
          status: "ready",
          view: withSeenTip(current.status === "ready" ? current.view : null, id),
        }));
        void savePreferences({ seenTips: [id] });
      },
      finishDiscovery: () => {
        setPreferences((current) =>
          current.status === "ready" && current.view
            ? { status: "ready", view: { ...current.view, onboardedAt: new Date().toISOString() } }
            : current,
        );
        void savePreferences({ onboarded: true });
      },
    }),
    [preferences],
  );

  // Her level names: the starting ones stay shown when they cannot be read.
  const refreshLoveLevels = useCallback(async () => {
    const levels = await fetchLoveLevels().catch(() => null);
    if (levels && alive.current) setLoveLevels(levels);
  }, []);

  // Read on arrival, and again whenever something changed elsewhere (another tab, her phone).
  useChangesPoller();
  useEffect(() => {
    alive.current = true;
    void refreshProfiles();
    void refreshLoveLevels();
    void refreshPreferences();
    return () => {
      alive.current = false;
    };
  }, [refreshProfiles, refreshLoveLevels, refreshPreferences]);
  useLiveRefresh(() => {
    void refreshProfiles();
    void refreshLoveLevels();
    void refreshPreferences();
  });

  return (
    <ProfilesContext.Provider value={{ profiles, ready, account, refreshProfiles, loveLevels, refreshLoveLevels }}>
      <PreferencesContext.Provider value={preferencesValue}>
        <AddSheetContext.Provider value={openAdd}>
          <a
            href="#app-content"
            className={`sr-only rounded-button bg-surface-raised px-space-3 py-space-2 focus:not-sr-only focus:absolute focus:top-space-2 focus:left-space-2 focus:z-30 ${focusRing}`}
          >
            {t("skipToContent")}
          </a>
          <div className="flex h-dvh overflow-hidden text-ink">
            <div className="flex min-h-space-0 min-w-space-0 flex-1 flex-col">
              <header className="relative z-10 shrink-0 bg-band text-band-ink">
                <div className="flex items-center gap-space-3 px-space-4 py-space-2 md:px-space-5 lg:gap-space-5-5">
                  <Link href="/" className={`font-title text-logo leading-none ${focusRing}`}>
                    {t("brand")}
                  </Link>
                  <Suspense>
                    <TopNav />
                  </Suspense>
                  <span className="flex-1" />
                  <Suspense>
                    <BandSearch />
                  </Suspense>
                  <button
                    type="button"
                    onClick={openAdd}
                    className={`relative hit-area hidden h-control-xs shrink-0 items-center rounded-pill bg-label px-space-4 text-caption font-bold text-label-ink md:inline-flex ${focusRing}`}
                  >
                    <span aria-hidden="true">+ {tNav("add")}</span>
                    <span className="sr-only">{tNav("addLabel")}</span>
                  </button>
                  <Suspense>
                    <ProfileSwitcher />
                    <Avatar />
                  </Suspense>
                </div>
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
                <BottomNav onAdd={openAdd} />
              </Suspense>
            </div>
          </div>
          <Suspense>
            <AddSheet open={adding} onClose={closeAdd} />
          </Suspense>
          <UndoToast />
          <GiftWarning />
          {discoveryShown(account, preferences) && <Onboarding onDone={preferencesValue.finishDiscovery} />}
        </AddSheetContext.Provider>
      </PreferencesContext.Provider>
    </ProfilesContext.Provider>
  );
}
