import { type Database, trackServer } from "@closyria/db";
import type { EventName } from "@closyria/shared";
import { MAX_ITEMS_CREATED_PER_HOUR } from "@closyria/shared";

type Window = { max: number; windowMs: number };

/** 300 item creations an hour per account (spec §7), anonymous sessions included. */
export const WARDROBE_LIMITS = {
  itemCreations: { max: MAX_ITEMS_CREATED_PER_HOUR, windowMs: 60 * 60 * 1000 },
} as const satisfies Record<string, Window>;

export type WardrobeDeps = {
  db: Database;
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
