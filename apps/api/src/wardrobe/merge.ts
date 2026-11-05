import type { DbExecutor } from "@closyria/auth";
import { asc, eq, inArray, schema, sql } from "@closyria/db";
import type { Tx } from "./events";
import { mergeItemInto } from "./merge-items";
import { lockProfilesOf } from "./profiles";

/**
 * Anonymous -> account merge of the wardrobe (spec §3 « Fusion anonyme → compte »). Four `reassign` functions for
 * `registerOwnedTable`, run by `reassignUserData` inside Better Auth's link transaction, in registration order:
 * profiles, tags, items, wishlists (media, registered before, have already moved). Each step leaves every foreign key
 * and unique index valid:
 * - profiles first: the anonymous « Moi » is folded into the account's before items move, so no item points to a
 *   deleted profile and none ends up in another user's profile;
 * - tags next: same-name tags are folded (item_tags re-pointed) before the remaining ones move, so the unique
 *   (user_id, lower(name)) holds;
 * - items: same-product active items are merged (`mergeItemInto`) before the others move, so the partial unique
 *   (user_id, product_id) WHERE deleted_at IS NULL holds; trashed items are outside it and move as they are;
 * - wishlists last: they simply move, after their positions.
 * Locks are taken in the order the API routes use (advisory lock, then rows by id), always on the account `to`.
 */

/** The link transaction, typed as Drizzle's (`reassignUserData` hands over `db.transaction`'s `tx`). */
function asTx(executor: DbExecutor): Tx {
  if (!("select" in executor && "update" in executor && "delete" in executor)) {
    throw new Error("the wardrobe merge needs a Drizzle transaction");
  }
  return executor as Tx;
}

const oldestFirst = [asc(schema.profiles.createdAt), asc(schema.profiles.id)];

/** « Moi » (each side's oldest profile) folded into the account's; the other profiles move after hers. */
export async function mergeProfiles(fromUserId: string, toUserId: string, executor: DbExecutor): Promise<void> {
  const tx = asTx(executor);
  // As the creation of « Moi » and the deletion of a profile: neither runs on the account meanwhile.
  await lockProfilesOf(tx, toUserId);
  const [accountMoi] = await tx
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, toUserId))
    .orderBy(...oldestFirst)
    .limit(1)
    .for("share");
  const [anonymousMoi] = await tx
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, fromUserId))
    .orderBy(...oldestFirst)
    .limit(1);
  if (!anonymousMoi) return;

  if (accountMoi) {
    // Her items and their history now point to the account's « Moi »; then the anonymous one holds nothing.
    await tx.execute(
      sql`update ${schema.items} set profile_id = ${accountMoi.id} where profile_id = ${anonymousMoi.id}`,
    );
    await tx.execute(
      sql`update ${schema.itemEvents} set from_profile_id = ${accountMoi.id} where from_profile_id = ${anonymousMoi.id}`,
    );
    await tx.execute(
      sql`update ${schema.itemEvents} set to_profile_id = ${accountMoi.id} where to_profile_id = ${anonymousMoi.id}`,
    );
    await tx.delete(schema.profiles).where(eq(schema.profiles.id, anonymousMoi.id));
  }
  // The others go after the account's profiles, in their order.
  await tx.execute(sql`
    update ${schema.profiles} as p
    set user_id = ${toUserId}, position = base.max + moved.rank
    from (
      select id, row_number() over (order by position, created_at, id)::int as rank
      from ${schema.profiles} where user_id = ${fromUserId}
    ) as moved,
    (select coalesce(max(position), -1) as max from ${schema.profiles} where user_id = ${toUserId}) as base
    where p.id = moved.id`);
}

/** Same name (case ignored): folded into the account's tag; the others move. May exceed the 200-tag cap (nothing lost). */
export async function mergeTags(fromUserId: string, toUserId: string, executor: DbExecutor): Promise<void> {
  const tx = asTx(executor);
  // As the creation of a tag: no same-name tag appears on the account meanwhile.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tags:${toUserId}`}, 0))`);
  await tx.execute(sql`
    select a.id from ${schema.tags} as a
    where a.user_id = ${toUserId}
      and lower(a.name) in (select lower(name) from ${schema.tags} where user_id = ${fromUserId})
    order by a.id
    for share`);
  await tx.execute(sql`
    insert into ${schema.itemTags} (item_id, tag_id)
    select it.item_id, a.id
    from ${schema.itemTags} as it
    join ${schema.tags} as s on s.id = it.tag_id and s.user_id = ${fromUserId}
    join ${schema.tags} as a on a.user_id = ${toUserId} and lower(a.name) = lower(s.name)
    on conflict do nothing`);
  // Their links to the anonymous tag go with it (cascade); they were copied above.
  await tx.execute(sql`
    delete from ${schema.tags} as s
    using ${schema.tags} as a
    where s.user_id = ${fromUserId} and a.user_id = ${toUserId} and lower(a.name) = lower(s.name)`);
  await tx.execute(sql`update ${schema.tags} set user_id = ${toUserId} where user_id = ${fromUserId}`);
}

/** Same product active on both sides: merged into the account's item (`mergeItemInto`); the others move. */
export async function mergeItems(fromUserId: string, toUserId: string, executor: DbExecutor): Promise<void> {
  const tx = asTx(executor);
  // As the creation and the restoration of an item: the account gains no active item for these products meanwhile.
  await tx.execute(sql`
    select pg_advisory_xact_lock(hashtextextended('items:' || ${toUserId}::text || ':' || p.product_id::text, 0))
    from (
      select distinct product_id from ${schema.items}
      where user_id = ${fromUserId} and deleted_at is null and product_id is not null
      order by product_id
    ) as p`);
  const pairs = await tx.execute<{ source_id: string; target_id: string }>(sql`
    select s.id as source_id, a.id as target_id
    from ${schema.items} as s
    join ${schema.items} as a on a.user_id = ${toUserId} and a.product_id = s.product_id and a.deleted_at is null
    where s.user_id = ${fromUserId} and s.deleted_at is null
    order by s.product_id`);
  if (pairs.rows.length > 0) {
    const ids = pairs.rows.flatMap((p) => [p.source_id, p.target_id]);
    const rows = await tx
      .select()
      .from(schema.items)
      .where(inArray(schema.items.id, ids))
      .orderBy(asc(schema.items.id))
      .for("update");
    const byId = new Map(rows.map((row) => [row.id, row]));
    const now = new Date();
    for (const { source_id, target_id } of pairs.rows) {
      const source = byId.get(source_id);
      const target = byId.get(target_id);
      if (!source || !target) throw new Error("item to merge vanished");
      await mergeItemInto(tx, source, target, now);
    }
  }
  await tx.execute(sql`update ${schema.items} set user_id = ${toUserId} where user_id = ${fromUserId}`);
}

/** Lists move after the account's, in their order; identical names are kept as they are. */
export async function mergeWishlists(fromUserId: string, toUserId: string, executor: DbExecutor): Promise<void> {
  const tx = asTx(executor);
  // As the creation and the reordering of lists.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`wishlists:${toUserId}`}, 0))`);
  await tx.execute(sql`
    update ${schema.wishlists} as w
    set user_id = ${toUserId}, position = base.max + moved.rank
    from (
      select id, row_number() over (order by position, created_at, id)::int as rank
      from ${schema.wishlists} where user_id = ${fromUserId}
    ) as moved,
    (select coalesce(max(position), -1) as max from ${schema.wishlists} where user_id = ${toUserId}) as base
    where w.id = moved.id`);
}
