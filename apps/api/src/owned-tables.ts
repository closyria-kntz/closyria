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
}
