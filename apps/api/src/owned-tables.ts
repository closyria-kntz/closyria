import { registerOwnedTable } from "@closyria/auth";
import { schema } from "@closyria/db";
import { registerEntitlementsOwnedTables } from "@closyria/entitlements";
import { mergeItems, mergeProfiles, mergeTags, mergeWishlists } from "./wardrobe/merge";

/**
 * Registers, in the API process, every table holding a user's data, so that anonymous -> account linking
 * (`onLinkAccount`, wired by `createAuth`) moves or merges it. New owned tables are added here.
 */
export function registerOwnedTables(): void {
  registerEntitlementsOwnedTables();
  // Photos simply move; their object keys keep the anonymous user's id (keys are opaque).
  registerOwnedTable(schema.media, schema.media.userId);
  // Audience events with a user move too; those with no user (null) stay anonymous.
  registerOwnedTable(schema.events, schema.events.userId);
  // Wardrobe: merged into the account (spec §3 « Fusion anonyme → compte », wardrobe/merge.ts). Registration order is
  // execution order and matters: media (above), profiles and tags are moved or folded before the items that point to
  // them, so the item merge only sees rows of the account; lists last.
  registerOwnedTable(schema.profiles, schema.profiles.userId, mergeProfiles);
  registerOwnedTable(schema.tags, schema.tags.userId, mergeTags);
  registerOwnedTable(schema.items, schema.items.userId, mergeItems);
  registerOwnedTable(schema.wishlists, schema.wishlists.userId, mergeWishlists);
}
