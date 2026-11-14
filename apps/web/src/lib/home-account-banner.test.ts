import { describe, expect, it } from "vitest";
import { DISMISS_KEY, type KeyValueStore } from "./account-prompt";
import {
  HOME_BANNER_KEY,
  readHomeBannerDismissedAt,
  shouldShowHomeBanner,
  writeHomeBannerDismissedAt,
} from "./home-account-banner";

const now = new Date("2026-11-14T12:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe("shouldShowHomeBanner", () => {
  it("shows to a guest who never closed it", () => {
    expect(shouldShowHomeBanner({ guest: true, dismissedAt: undefined, now })).toBe(true);
  });

  it("never shows to an account, nor before the shell knows", () => {
    expect(shouldShowHomeBanner({ guest: false, dismissedAt: undefined, now })).toBe(false);
    expect(shouldShowHomeBanner({ guest: null, dismissedAt: undefined, now })).toBe(false);
  });

  it("stays closed for 30 days, then comes back", () => {
    expect(shouldShowHomeBanner({ guest: true, dismissedAt: daysAgo(29.9), now })).toBe(false);
    expect(shouldShowHomeBanner({ guest: true, dismissedAt: daysAgo(30), now })).toBe(true);
    // A date in the future (clock change) counts as just closed.
    expect(shouldShowHomeBanner({ guest: true, dismissedAt: daysAgo(-2), now })).toBe(false);
  });
});

describe("its memory in the browser", () => {
  it("keeps its own date, apart from the account proposal's", () => {
    const store = memory();
    writeHomeBannerDismissedAt(now, store);
    expect(readHomeBannerDismissedAt(store)).toEqual(now);
    expect(store.data.has(HOME_BANNER_KEY)).toBe(true);
    expect(store.data.has(DISMISS_KEY)).toBe(false);
  });

  it("never throws when storage is blocked", () => {
    const blocked: KeyValueStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    expect(readHomeBannerDismissedAt(blocked)).toBeUndefined();
    expect(() => writeHomeBannerDismissedAt(now, blocked)).not.toThrow();
  });
});
