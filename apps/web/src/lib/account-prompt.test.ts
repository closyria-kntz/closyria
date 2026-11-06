import { describe, expect, it } from "vitest";
import {
  DISMISS_KEY,
  markPromptFollowed,
  readDismissedAt,
  shouldPromptAccount,
  takePromptFollowed,
  writeDismissedAt,
} from "./account-prompt";

const NOW = new Date("2026-11-06T12:00:00Z");
const base = { isAnonymous: true, itemCount: 3, trigger: "save" as const, now: NOW };
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

describe("shouldPromptAccount", () => {
  it("says no for the 2nd kept item and yes for the 3rd", () => {
    expect(shouldPromptAccount({ ...base, itemCount: 1 })).toBe(false);
    expect(shouldPromptAccount({ ...base, itemCount: 2 })).toBe(false);
    expect(shouldPromptAccount({ ...base, itemCount: 3 })).toBe(true);
    expect(shouldPromptAccount({ ...base, itemCount: 12 })).toBe(true);
  });

  it("says yes on a share or a photo even for the first item", () => {
    expect(shouldPromptAccount({ ...base, itemCount: 1, trigger: "share" })).toBe(true);
    expect(shouldPromptAccount({ ...base, itemCount: 1, trigger: "photo" })).toBe(true);
  });

  it("never prompts a signed-in account", () => {
    for (const trigger of ["save", "share", "photo"] as const) {
      expect(shouldPromptAccount({ ...base, isAnonymous: false, trigger })).toBe(false);
    }
  });

  it("stays quiet for 7 days after she closed it", () => {
    expect(shouldPromptAccount({ ...base, dismissedAt: daysAgo(1) })).toBe(false);
    expect(shouldPromptAccount({ ...base, dismissedAt: daysAgo(6.9) })).toBe(false);
    expect(shouldPromptAccount({ ...base, dismissedAt: daysAgo(7) })).toBe(true);
    expect(shouldPromptAccount({ ...base, dismissedAt: daysAgo(30) })).toBe(true);
  });

  it("ignores a dismissal date in the future (clock change) as if she had just closed it", () => {
    expect(shouldPromptAccount({ ...base, dismissedAt: new Date(NOW.getTime() + 86_400_000) })).toBe(false);
  });
});

function storage(items: Record<string, string> = {}) {
  return {
    getItem: (key: string) => items[key] ?? null,
    setItem: (key: string, value: string) => {
      items[key] = value;
    },
    removeItem: (key: string) => {
      delete items[key];
    },
  };
}
const broken = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  },
  removeItem: () => {
    throw new Error("denied");
  },
};

describe("dismissal date in localStorage", () => {
  it("writes and reads it back", () => {
    const store = storage();
    writeDismissedAt(NOW, store);
    expect(store.getItem(DISMISS_KEY)).toBe(NOW.toISOString());
    expect(readDismissedAt(store)).toEqual(NOW);
  });

  it("reads nothing when absent or not a date", () => {
    expect(readDismissedAt(storage())).toBeUndefined();
    expect(readDismissedAt(storage({ [DISMISS_KEY]: "hier" }))).toBeUndefined();
  });

  it("does not crash when localStorage throws", () => {
    expect(readDismissedAt(broken)).toBeUndefined();
    expect(() => writeDismissedAt(NOW, broken)).not.toThrow();
    expect(takePromptFollowed(broken)).toBe(false);
    expect(() => markPromptFollowed(broken)).not.toThrow();
    expect(readDismissedAt(undefined)).toBeUndefined();
  });
});

describe("followed flag", () => {
  it("is taken once", () => {
    const store = storage();
    markPromptFollowed(store);
    expect(takePromptFollowed(store)).toBe(true);
    expect(takePromptFollowed(store)).toBe(false);
  });
});
