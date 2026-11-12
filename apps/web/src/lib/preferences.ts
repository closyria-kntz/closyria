"use client";

import type { PreferencesView } from "@closyria/shared";
import { createContext, useContext } from "react";

/** What the shell knows of her preferences: still reading, or read (null without a session: nothing remembered). */
export type PreferencesState = { status: "loading" } | { status: "ready"; view: PreferencesView | null };

/** A tip shows once her preferences are read and as long as she has not closed it (on any of her devices). */
export function tipShown(state: PreferencesState, id: string): boolean {
  return state.status === "ready" && !(state.view?.seenTips.includes(id) ?? false);
}

/**
 * The first-opening discovery is for any account that has neither seen nor skipped it, guests included; a visitor
 * without a session yet (nothing remembered: null) gets it too, and skipping it opens her guest session. The API
 * already counts an account that keeps articles as done. Nothing shows while her preferences are being read.
 */
export function discoveryShown(state: PreferencesState): boolean {
  return state.status === "ready" && (state.view === null || state.view.onboardedAt === null);
}

/**
 * What was just read, without undoing what she did on this page meanwhile (a read that left before her save landed):
 * a discovery done here stays done, a tip closed here stays closed.
 */
export function mergeRead(current: PreferencesState, read: PreferencesView | null): PreferencesView | null {
  if (current.status !== "ready" || current.view === null) return read;
  const base = read ?? { seenTips: [], onboardedAt: null };
  return {
    seenTips: [...base.seenTips, ...current.view.seenTips.filter((id) => !base.seenTips.includes(id))],
    onboardedAt: base.onboardedAt ?? current.view.onboardedAt,
  };
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
