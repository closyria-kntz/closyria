import { registerOwnedTable } from "@closyria/auth";
import { schema } from "@closyria/db";
import { registerEntitlementsOwnedTables } from "@closyria/entitlements";

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
  // Wardrobe: generic move for now; the merge functions (same product, same tag name...) come with the migration of
  // anonymous data (chantier 2a, task 10). Order matters: profiles and tags before the items that point to them.
  registerOwnedTable(schema.profiles, schema.profiles.userId);
  registerOwnedTable(schema.tags, schema.tags.userId);
  registerOwnedTable(schema.items, schema.items.userId);
  registerOwnedTable(schema.wishlists, schema.wishlists.userId);
}
