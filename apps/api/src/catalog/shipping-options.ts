import { asc, type Database, eq, schema } from "@closyria/db";
import type { ShippingOption } from "@closyria/shared";

export function shapeShippingOption(row: typeof schema.shopShippingOptions.$inferSelect): ShippingOption {
  return {
    id: row.id,
    label: row.label,
    shippingCents: row.shippingCents,
    freeFromCents: row.freeFromCents,
    position: row.position,
  };
}

/** A shop's delivery options, in the order the admin gave them. */
export async function listShippingOptions(db: Database, shopId: string): Promise<ShippingOption[]> {
  const rows = await db
    .select()
    .from(schema.shopShippingOptions)
    .where(eq(schema.shopShippingOptions.shopId, shopId))
    .orderBy(asc(schema.shopShippingOptions.position), asc(schema.shopShippingOptions.createdAt));
  return rows.map(shapeShippingOption);
}
