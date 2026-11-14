import { type SQL, schema, sql } from "@closyria/db";
import type { Tx } from "./events";

/**
 * Her alerts follow the profile of their item (spec §5 « Profils »): after items change profile, the matching
 * `alert_events` take the item's profile again, so « Nouvelles » shows them there and deleting the old profile
 * (which cascades) does not take them away. `which` picks the alerts to look at.
 */
async function followItemProfile(tx: Tx, which: SQL): Promise<void> {
  await tx.execute(sql`
    update ${schema.alertEvents} as e
    set profile_id = i.profile_id
    from ${schema.items} as i
    where i.id = e.item_id and e.profile_id is distinct from i.profile_id and ${which}`);
}

/** After these items moved to another profile. */
export async function alertsFollowItems(tx: Tx, itemIds: readonly string[]): Promise<void> {
  if (itemIds.length === 0) return;
  await followItemProfile(
    tx,
    sql`e.item_id in (${sql.join(
      itemIds.map((id) => sql`${id}`),
      sql`, `,
    )})`,
  );
}

/** Before a profile is deleted: its alerts whose item now lives in another profile go with the item. */
export async function alertsLeaveProfile(tx: Tx, profileId: string): Promise<void> {
  await followItemProfile(tx, sql`e.profile_id = ${profileId}`);
}
