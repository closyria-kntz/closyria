import { type Database, type TrackedEvent, trackServer } from "@closyria/db";
import type { EventName } from "@closyria/shared";
import { MAX_ITEMS_CREATED_PER_HOUR } from "@closyria/shared";

type Window = { max: number; windowMs: number };

/** 300 item creations an hour per account (spec §7), anonymous sessions included. */
export const WARDROBE_LIMITS = {
  itemCreations: { max: MAX_ITEMS_CREATED_PER_HOUR, windowMs: 60 * 60 * 1000 },
} as const satisfies Record<string, Window>;

export type WardrobeDeps = {
  db: Database;
  /** AES-256 key that seals share tokens (parsed once at startup). */
  shareLinkKey: Buffer;
  /** Clock, injectable for tests. */
  now?: () => Date;
  /** Overrides of WARDROBE_LIMITS (tests). */
  limits?: { itemCreations?: Window };
};

/** Audience event born on the server (spec §6). A failure is logged, never fails the action that already happened. */
export async function trackItemEvent(
  db: Database,
  userId: string,
  name: Extract<EventName, "item_saved" | "item_stage_changed" | "item_moved">,
  props: Record<string, string>,
): Promise<void> {
  try {
    await trackServer(db, { name, path: "/api/me/items", userId, props });
  } catch (error) {
    console.error("audience event not recorded:", error);
  }
}

/**
 * Audience events of a batch: one row per item changed (the stats count rows), written in a single INSERT. A failure
 * is logged, never fails the action that already happened.
 */
export async function trackItemEvents(
  db: Database,
  userId: string,
  events: { name: Extract<EventName, "item_stage_changed" | "item_moved">; props: Record<string, string> }[],
  occurredAt: Date,
): Promise<void> {
  if (events.length === 0) return;
  const rows: TrackedEvent[] = events.map((e) => ({ ...e, path: "/api/me/items", userId, occurredAt }));
  try {
    await trackServer(db, rows);
  } catch (error) {
    console.error("audience events not recorded:", error);
  }
}

/** The `wishlist_shared` audience event: one row, no list id, no token (spec §6). Failures are logged only. */
export async function trackWishlistShared(db: Database, userId: string): Promise<void> {
  try {
    await trackServer(db, { name: "wishlist_shared", path: "/api/me/wishlists", userId, props: {} });
  } catch (error) {
    console.error("audience event not recorded:", error);
  }
}
