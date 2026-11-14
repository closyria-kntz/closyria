import type { DbTransaction } from "@closyria/auth";
import { schema, sql } from "@closyria/db";

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
