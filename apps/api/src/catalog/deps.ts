import type { Database } from "@closyria/db";
import type { ObjectStore } from "@closyria/storage";
import type { CaptureQueue } from "./capture-queue";

type Window = { max: number; windowMs: number };

/**
 * Capture limits (spec §6): 30 an hour for an anonymous session, 100 with an account, and 200 an hour per
 * client address, so that recreating anonymous sessions does not lift the first one.
 */
export const CATALOG_LIMITS = {
  perAnonymousUser: { max: 30, windowMs: 60 * 60 * 1000 },
  perUser: { max: 100, windowMs: 60 * 60 * 1000 },
  perAddress: { max: 200, windowMs: 60 * 60 * 1000 },
} as const satisfies Record<string, Window>;

export type CatalogDeps = {
  db: Database;
  /** Catalog photos (`products/<productId>/<hash>.webp`). */
  store: ObjectStore;
  queue: CaptureQueue;
  now?: () => Date;
  /** Overrides of CATALOG_LIMITS (tests). */
  limits?: { perAnonymousUser?: Window; perUser?: Window; perAddress?: Window };
};
