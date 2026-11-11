"use client";

import type { PreferencesView, SummaryView } from "@closyria/shared";
import { createContext, useContext } from "react";

/** What the shell knows of her preferences: still reading, or read (null without a session: nothing remembered). */
export type PreferencesState = { status: "loading" } | { status: "ready"; view: PreferencesView | null };

/** A tip shows once her preferences are read and as long as she has not closed it (on any of her devices). */
export function tipShown(state: PreferencesState, id: string): boolean {
  return state.status === "ready" && !(state.view?.seenTips.includes(id) ?? false);
}

/**
 * The first-opening discovery is for a signed-in account (an e-mail) that has neither seen nor skipped it; the API
 * already counts an account that keeps articles as done. A guest, or anything still being read, gets none.
 */
export function discoveryShown(account: SummaryView["account"] | null, state: PreferencesState): boolean {
  return account?.email != null && state.status === "ready" && state.view !== null && state.view.onboardedAt === null;
}

/** Her preferences once `id` is closed (at once on screen, before the API answers). */
export function withSeenTip(view: PreferencesView | null, id: string): PreferencesView {
  const base = view ?? { seenTips: [], onboardedAt: null };
  return base.seenTips.includes(id) ? base : { ...base, seenTips: [...base.seenTips, id] };
}

export type PreferencesContextValue = {
  state: PreferencesState;
  closeTip: (id: string) => void;
  finishDiscovery: () => void;
};

/** Filled by the app shell; outside it nothing is read, so no tip shows. */
export const PreferencesContext = createContext<PreferencesContextValue>({
  state: { status: "loading" },
  closeTip: () => {},
  finishDiscovery: () => {},
});

export const usePreferences = () => useContext(PreferencesContext);
