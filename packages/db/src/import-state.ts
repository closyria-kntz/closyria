import { CATALOGUE_IMPORT_DEAD_MS, CATALOGUE_IMPORT_STALE_MS } from "@closyria/shared";
import { sql } from "drizzle-orm";
import { shops } from "./schema/catalog";

/**
 * SQL twin of `liveImportState(…) === null` (`@closyria/shared`), for the shop rows: no import queued or running, or a
 * dead one (queued over 6 h, running without heartbeat, else since its start, for 10 min). « Importer maintenant » and
 * the nightly plan only queue a shop that matches.
 */
export function importNotUnderWay(at: Date) {
  const queuedSince = new Date(at.getTime() - CATALOGUE_IMPORT_STALE_MS).toISOString();
  const aliveSince = new Date(at.getTime() - CATALOGUE_IMPORT_DEAD_MS).toISOString();
  return sql`(${shops.importState} is null or ${shops.importStartedAt} is null
    or (${shops.importState} = 'queued' and ${shops.importStartedAt} < ${queuedSince})
    or (${shops.importState} = 'running' and coalesce(${shops.importHeartbeatAt}, ${shops.importStartedAt}) < ${aliveSince}))`;
}
