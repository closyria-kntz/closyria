import { and, count, type Database, eq, isNull, type SQL, schema, sql } from "@closyria/db";
import type { ItemCounts } from "@closyria/shared";
import { isInDressing, isReceived } from "./received";

/** Her items not in the trash at each step of « Mes articles » (one profile's with `profileId`), in one query. */
export async function countItems(
  db: Database,
  userId: string,
  profileId: string | null,
  now: Date,
): Promise<ItemCounts> {
  const conditions: SQL[] = [eq(schema.items.userId, userId), isNull(schema.items.deletedAt)];
  if (profileId) conditions.push(eq(schema.items.profileId, profileId));
  const of = (condition: SQL) => count(sql`case when ${condition} then 1 end`);
  const [row] = await db
    .select({
      envie: of(eq(schema.items.stage, "spotted")),
      commande: of(eq(schema.items.stage, "ordered")),
      recu: of(isReceived(now)),
      dressing: of(isInDressing(now)),
      aVendre: of(eq(schema.items.stage, "for_sale")),
    })
    .from(schema.items)
    .where(and(...conditions));
  return row ?? { envie: 0, commande: 0, recu: 0, dressing: 0, aVendre: 0 };
}
