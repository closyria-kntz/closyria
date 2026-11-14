import type { DbTransaction } from "@closyria/auth";
import { and, asc, eq, inArray, isNotNull, isNull, schema, sql } from "@closyria/db";
import { MAX_SEEN_TIPS } from "@closyria/shared";
import { lockProductOfUser } from "./items";
import { mergeItemInto } from "./merge-items";
import { lockProfilesOf, PROFILE_ORDER } from "./profiles";

/**
 * Anonymous -> account merge of the wardrobe (spec §3 « Fusion anonyme → compte »). Four `reassign` functions for
 * `registerOwnedTable`, run by `reassignUserData` inside Better Auth's link transaction, in registration order:
 * profiles, tags, items, wishlists (media, registered before, have already moved). Each step leaves every foreign key
 * and unique index valid:
 * - profiles first: the anonymous « Moi » (each side's first profile by position, as `firstProfile`) is folded into the account's before items move, so no item points to a
 *   deleted profile and none ends up in another user's profile;
 * - tags next: same-name tags are folded (item_tags re-pointed) before the remaining ones move, so the unique
 *   (user_id, lower(name)) holds;
 * - items: same-product active items are merged (`mergeItemInto`) before the others move, so the partial unique
 *   (user_id, product_id) WHERE deleted_at IS NULL holds; trashed items are outside it and move as they are;
 * - wishlists last: they simply move, after their positions.
 * Locks are taken in the order the API routes use (advisory lock, then rows by id), always on the account `to`.
 */

/** « Moi » (each side's first profile by position) folded into the account's; the other profiles move after hers. */
export async function mergeProfiles(fromUserId: string, toUserId: string, tx: DbTransaction): Promise<void> {
  // As the creation of « Moi » and the deletion of a profile: neither runs on the account meanwhile.
  await lockProfilesOf(tx, toUserId);
  const [accountMoi] = await tx
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, toUserId))
    .orderBy(...PROFILE_ORDER)
    .limit(1)
    .for("share");
  const [anonymousMoi] = await tx
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, fromUserId))
    .orderBy(...PROFILE_ORDER)
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
    // Her alerts too (« Nouvelles », « unes »): the profile's deletion below would take them (cascade). Their user_id
    // follows with the alert_events table, registered after.
    await tx.execute(
      sql`update ${schema.alertEvents} set profile_id = ${accountMoi.id} where profile_id = ${anonymousMoi.id}`,
    );
    // Her « Moi » budget goes to the account's « Moi » when it has none; else the account's wins and hers is
    // dropped with the profile (cascade). Its user_id follows with the budgets table, registered after.
    await tx.execute(sql`
      update ${schema.budgets} set profile_id = ${accountMoi.id}
      where profile_id = ${anonymousMoi.id}
        and not exists (select 1 from ${schema.budgets} where profile_id = ${accountMoi.id})`);
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
export async function mergeTags(fromUserId: string, toUserId: string, tx: DbTransaction): Promise<void> {
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
  // The account's tag keeps its colour; the anonymous one fills it when it has none.
  await tx.execute(sql`
    update ${schema.tags} as a
    set color = s.color
    from ${schema.tags} as s
    where a.user_id = ${toUserId} and s.user_id = ${fromUserId} and lower(a.name) = lower(s.name)
      and a.color is null and s.color is not null`);
  // Their links to the anonymous tag go with it (cascade); they were copied above.
  await tx.execute(sql`
    delete from ${schema.tags} as s
    using ${schema.tags} as a
    where s.user_id = ${fromUserId} and a.user_id = ${toUserId} and lower(a.name) = lower(s.name)`);
  await tx.execute(sql`update ${schema.tags} set user_id = ${toUserId} where user_id = ${fromUserId}`);
}

/** Same product active on both sides: merged into the account's item (`mergeItemInto`); the others move. */
export async function mergeItems(fromUserId: string, toUserId: string, tx: DbTransaction): Promise<void> {
  // As the creation and the restoration of an item: the account gains no active item for these products meanwhile.
  // One lock per product, by product id (as bulk.ts), so two merges or a batch restore never wait on each other in a
  // cycle.
  const products = await tx
    .selectDistinct({ productId: schema.items.productId })
    .from(schema.items)
    .where(and(eq(schema.items.userId, fromUserId), isNull(schema.items.deletedAt), isNotNull(schema.items.productId)));
  const productIds = products.flatMap((p) => (p.productId ? [p.productId] : [])).sort();
  for (const productId of productIds) await lockProductOfUser(tx, toUserId, productId);
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
export async function mergeWishlists(fromUserId: string, toUserId: string, tx: DbTransaction): Promise<void> {
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

/** Her own level names: the account's win when it has some, else the anonymous ones move. */
export async function mergeLoveLevels(fromUserId: string, toUserId: string, tx: DbTransaction): Promise<void> {
  await tx.execute(sql`
    insert into ${schema.loveLevels} (user_id, level, emoji, label)
    select ${toUserId}, level, emoji, label from ${schema.loveLevels}
    where user_id = ${fromUserId}
      and not exists (select 1 from ${schema.loveLevels} where user_id = ${toUserId})`);
  await tx.delete(schema.loveLevels).where(eq(schema.loveLevels.userId, fromUserId));
}

/** « Derniers liens »: folded into the account's by product, the latest visit wins; the anonymous rows are removed. */
export async function mergeRecentProducts(fromUserId: string, toUserId: string, tx: DbTransaction): Promise<void> {
  await tx.execute(sql`
    insert into ${schema.recentProducts} (user_id, product_id, visited_at)
    select ${toUserId}, product_id, visited_at from ${schema.recentProducts} where user_id = ${fromUserId}
    on conflict (user_id, product_id)
    do update set visited_at = greatest(${schema.recentProducts.visitedAt}, excluded.visited_at)`);
  await tx.delete(schema.recentProducts).where(eq(schema.recentProducts.userId, fromUserId));
}

/**
 * Her preferences (refonte Boudoir, task 7), kept on the `user` row: the discovery counts as seen from the earliest of
 * the two dates (LEAST skips a null), the closed tips are the union, the account's first; past MAX_SEEN_TIPS, the
 * newest are kept (the oldest forgotten first), as PATCH /api/me/preferences does.
 */
export async function mergePreferences(fromUserId: string, toUserId: string, tx: DbTransaction): Promise<void> {
  await tx.execute(sql`
    update ${schema.user} as target
       set onboarded_at = least(target.onboarded_at, source.onboarded_at),
           seen_tips = (select coalesce(array_agg(tip order by first_at), '{}'::text[]) from (
             select tip, min(pos) as first_at
               from unnest(target.seen_tips || source.seen_tips) with ordinality as u(tip, pos)
              group by tip order by first_at desc limit ${MAX_SEEN_TIPS}) kept)
      from ${schema.user} as source
     where target.id = ${toUserId} and source.id = ${fromUserId}`);
}
