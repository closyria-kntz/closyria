import { type ItemStage, type ItemView, MAX_GIFT_CHECK_ITEMS } from "@closyria/shared";
import { fetchReservedIds, markGiftTook } from "./wardrobe-client";

/** What she was about to do: « Je le prends », « J'ai commandé », or a move to « Commandé » / « Reçu ». */
export type GiftWarningKind = "take" | "order" | "stage";

/** The window « Attends un peu 🎁 » on screen: how many of the items a friend plans to give, and for what. */
export type GiftWarningRequest = { id: number; count: number; kind: GiftWarningKind };

type Pending = { request: GiftWarningRequest; resolve: (go: boolean) => void };

let pending: Pending | null = null;
let counter = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

/** The request on screen, or null (for `useSyncExternalStore`). */
export const getGiftWarning = (): GiftWarningRequest | null => pending?.request ?? null;

export function subscribeGiftWarning(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Her answer to the window on screen: true « … quand même », false « Attendre » (or closed). Once per window. */
export function answerGiftWarning(id: number, go: boolean): void {
  if (!pending || pending.request.id !== id) return;
  const { resolve } = pending;
  pending = null;
  emit();
  resolve(go);
}

/** Opens the window and waits for her answer; without a window mounted, nothing to ask: she goes on. */
function ask(count: number, kind: GiftWarningKind): Promise<boolean> {
  if (listeners.size === 0) return Promise.resolve(true);
  // A window already up (a second purchase meanwhile): that one waits.
  if (pending) answerGiftWarning(pending.request.id, false);
  return new Promise((resolve) => {
    pending = { request: { id: ++counter, count, kind }, resolve };
    emit();
  });
}

export type GiftCheckDeps = {
  check: (ids: readonly string[]) => Promise<string[]>;
  took: (ids: readonly string[]) => Promise<unknown>;
};
const defaultDeps: GiftCheckDeps = { check: fetchReservedIds, took: markGiftTook };

/**
 * Right before she buys (spec § 4): are any of these items a friend's planned gift? None: true at once, no window.
 * Some: « Attends un peu 🎁 »; « Attendre » → false (nothing happens), « … quand même » → her friends are told she
 * took them herself, then true. The check failing never blocks a purchase: true, without a window. Never called to
 * show anything, never polled: it is the only moment the app learns « réservé », and only as ids.
 */
export async function confirmUnlessReserved(
  ids: readonly string[],
  kind: GiftWarningKind,
  deps: GiftCheckDeps = defaultDeps,
): Promise<boolean> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return true;
  const reserved: string[] = [];
  try {
    for (let start = 0; start < unique.length; start += MAX_GIFT_CHECK_ITEMS) {
      reserved.push(...(await deps.check(unique.slice(start, start + MAX_GIFT_CHECK_ITEMS))));
    }
  } catch {
    return true;
  }
  if (reserved.length === 0) return true;
  if (!(await ask(reserved.length, kind))) return false;
  try {
    for (let start = 0; start < reserved.length; start += MAX_GIFT_CHECK_ITEMS) {
      await deps.took(reserved.slice(start, start + MAX_GIFT_CHECK_ITEMS));
    }
  } catch {
    // Her purchase goes on all the same.
  }
  return true;
}

/** A move that buys the item (from her wishes or her order to « Commandé » / « Reçu »): asked first. */
export function isPurchaseMove(from: ItemStage, to: ItemStage): boolean {
  return (from === "spotted" || from === "ordered") && (to === "ordered" || to === "owned") && from !== to;
}

/** « Reçu en cadeau » is offered: not a gift yet, not in the trash, and not sold or on sale (it would come back). */
export function canReceiveAsGift(item: Pick<ItemView, "stage" | "receivedAsGift" | "deletedAt">): boolean {
  return (
    !item.receivedAsGift && item.deletedAt === null && ["spotted", "ordered", "owned", "returned"].includes(item.stage)
  );
}

/** How a take's check ended: she goes on, she waits, or a second tap took it back meanwhile. */
export type TakeOutcome = "go" | "wait" | "cancelled";

/**
 * « Je le prends » on an item, checked first, while the tick already shows. A second tap on the same item while its
 * check runs takes the first one back (`cancel` → true; the check then ends `cancelled`): the last tap wins, as with
 * the ticks.
 */
export function createTakeGuard(
  confirm: (ids: readonly string[]) => Promise<boolean> = (ids) => confirmUnlessReserved(ids, "take"),
) {
  const checking = new Map<string, { cancelled: boolean }>();
  return {
    async check(id: string): Promise<TakeOutcome> {
      const entry = { cancelled: false };
      checking.set(id, entry);
      const go = await confirm([id]);
      if (checking.get(id) === entry) checking.delete(id);
      if (entry.cancelled) return "cancelled";
      return go ? "go" : "wait";
    },
    /** A check runs for `id`: it is taken back (true). */
    cancel(id: string): boolean {
      const entry = checking.get(id);
      if (!entry) return false;
      entry.cancelled = true;
      checking.delete(id);
      return true;
    },
  };
}
