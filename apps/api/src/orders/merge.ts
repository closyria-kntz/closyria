import type { DbTransaction } from "@closyria/auth";
import { schema, sql } from "@closyria/db";
import { MAX_SENDER_ADDRESSES } from "@closyria/shared";

/**
 * Anonymous -> account merge of her order addresses (« Après la commande »). Addresses are for accounts only, so a
 * guest should hold none; should she, they move like any owned row, deactivated first when the account already has an
 * active one (one active address per account, `order_inboxes_user_id_active_idx`). Their e-mails keep pointing to
 * them and move with the `inbound_emails` table, registered after.
 */
export async function mergeOrderInboxes(fromUserId: string, toUserId: string, tx: DbTransaction): Promise<void> {
  await tx.execute(sql`
    update ${schema.orderInboxes} set active = false
    where user_id = ${fromUserId} and active
      and exists (select 1 from ${schema.orderInboxes} where user_id = ${toUserId} and active)`);
  await tx.execute(sql`update ${schema.orderInboxes} set user_id = ${toUserId} where user_id = ${fromUserId}`);
}

/**
 * Anonymous -> account merge of « Mes adresses d'envoi » (spec §11). A guest cannot add any (accounts only); should she
 * hold some, they move, one address once per account (`order_sender_addresses_user_id_email_idx`): an address both
 * have is kept on the account's row, verified if either was. The cap of 10 holds afterwards (verified ones kept first).
 */
export async function mergeOrderSenders(fromUserId: string, toUserId: string, tx: DbTransaction): Promise<void> {
  const t = schema.orderSenderAddresses;
  await tx.execute(sql`
    update ${t} as mine
    set verified_at = theirs.verified_at, code_hash = null, code_salt = null, code_expires_at = null, attempts = 0
    from ${t} as theirs
    where mine.user_id = ${toUserId} and mine.verified_at is null
      and theirs.user_id = ${fromUserId} and theirs.email = mine.email and theirs.verified_at is not null`);
  await tx.execute(sql`
    delete from ${t} as theirs
    where theirs.user_id = ${fromUserId}
      and exists (select 1 from ${t} as mine where mine.user_id = ${toUserId} and mine.email = theirs.email)`);
  await tx.execute(sql`update ${t} set user_id = ${toUserId} where user_id = ${fromUserId}`);
  // Still 10 addresses at most, the account's included: the verified ones first, then the oldest; the rest dropped.
  await tx.execute(sql`
    delete from ${t} where id in (
      select id from (
        select id, row_number() over (order by verified_at is null, created_at, id) as rank
        from ${t} where user_id = ${toUserId}
      ) ranked
      where rank > ${MAX_SENDER_ADDRESSES - 1})`);
}

/** The guest's count of codes sent this hour is dropped: the account keeps its own (one row per account). */
export async function mergeOrderSenderSends(fromUserId: string, _toUserId: string, tx: DbTransaction): Promise<void> {
  await tx.execute(sql`delete from ${schema.orderSenderSends} where user_id = ${fromUserId}`);
}
