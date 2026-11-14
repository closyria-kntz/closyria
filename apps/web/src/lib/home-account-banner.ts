import { readDismissedAt, writeDismissedAt } from "./account-prompt";

/**
 * The Home banner « Crée ton compte… » for guests (comptes visibles 2026-11-14): closed, it stays closed in this
 * browser for 30 days. Never for an account.
 */
export const HOME_BANNER_KEY = "closyria.homeAccountBanner.dismissedAt";
export const HOME_BANNER_COOLDOWN_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export function shouldShowHomeBanner(state: {
  guest: boolean | null;
  dismissedAt: Date | undefined;
  now: Date;
}): boolean {
  if (state.guest !== true) return false;
  if (!state.dismissedAt) return true;
  // A date in the future (clock change) counts as « just closed ».
  return state.now.getTime() - state.dismissedAt.getTime() >= HOME_BANNER_COOLDOWN_DAYS * DAY_MS;
}

export const readHomeBannerDismissedAt = (store?: Parameters<typeof readDismissedAt>[0]) =>
  readDismissedAt(store, HOME_BANNER_KEY);

export const writeHomeBannerDismissedAt = (now: Date = new Date(), store?: Parameters<typeof writeDismissedAt>[1]) =>
  writeDismissedAt(now, store, HOME_BANNER_KEY);
