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
  // Wardrobe: generic move for now. The order (profiles and tags before the items that point to them) is a convention
  // for the merge functions of chantier 2a task 10, not a requirement of the generic move.
  // Known interim gap until task 10: linking an anonymous account to one that already has the same product (items) or
  // the same tag name (tags) may hit a unique violation.
  registerOwnedTable(schema.profiles, schema.profiles.userId);
  registerOwnedTable(schema.tags, schema.tags.userId);
  registerOwnedTable(schema.items, schema.items.userId);
  registerOwnedTable(schema.wishlists, schema.wishlists.userId);
}
