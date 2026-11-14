/** G6: when to offer an anonymous visitor to create an account (a dismissible banner, never blocking). */
export type PromptTrigger = "save" | "share" | "photo";

export const PROMPT_ITEM_THRESHOLD = 3;
export const PROMPT_COOLDOWN_DAYS = 7;
export const DISMISS_KEY = "closyria.accountPrompt.dismissedAt";
/** Set when she follows the banner's button; seen again after sign-in to count `account_created_from_prompt`. */
export const FOLLOWED_KEY = "closyria.accountPrompt.followed";

export type PromptState = {
  isAnonymous: boolean;
  /** Active items, the one just kept included. */
  itemCount: number;
  trigger: PromptTrigger;
  /** When she last closed the banner. */
  dismissedAt?: Date | undefined;
  now?: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function shouldPromptAccount(state: PromptState): boolean {
  if (!state.isAnonymous) return false;
  const moment = state.trigger === "share" || state.trigger === "photo" || state.itemCount >= PROMPT_ITEM_THRESHOLD;
  if (!moment) return false;
  if (state.dismissedAt) {
    const since = (state.now ?? new Date()).getTime() - state.dismissedAt.getTime();
    // A date in the future (clock change) counts as « just closed ».
    if (since < PROMPT_COOLDOWN_DAYS * DAY_MS) return false;
  }
  return true;
}

export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const browserStore = (): KeyValueStore | undefined => {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined; // access itself can throw (blocked storage)
  }
};

/** When a banner was last closed (`key`: the G6 proposal by default, or another banner's key). */
export function readDismissedAt(
  store: KeyValueStore | undefined = browserStore(),
  key: string = DISMISS_KEY,
): Date | undefined {
  try {
    const raw = store?.getItem(key);
    if (!raw) return undefined;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? undefined : date;
  } catch {
    return undefined;
  }
}

export function writeDismissedAt(
  now: Date = new Date(),
  store: KeyValueStore | undefined = browserStore(),
  key: string = DISMISS_KEY,
): void {
  try {
    store?.setItem(key, now.toISOString());
  } catch {}
}

export function markPromptFollowed(store: KeyValueStore | undefined = browserStore()): void {
  try {
    store?.setItem(FOLLOWED_KEY, "1");
  } catch {}
}

/** True once, after she came back signed in from the banner. */
export function takePromptFollowed(store: KeyValueStore | undefined = browserStore()): boolean {
  try {
    if (store?.getItem(FOLLOWED_KEY) !== "1") return false;
    store.removeItem(FOLLOWED_KEY);
    return true;
  } catch {
    return false;
  }
}

// --- the banner's state, shared between the triggers (product page, lists) and the shell ---

let visible = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

export const isAccountPromptVisible = (): boolean => visible;
export function subscribeAccountPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function hideAccountPrompt(): void {
  if (!visible) return;
  visible = false;
  emit();
}
/** Shows the banner; true when it was not showing yet (the caller then counts `account_prompt_shown`). */
export function showAccountPrompt(): boolean {
  if (visible) return false;
  visible = true;
  emit();
  return true;
}
