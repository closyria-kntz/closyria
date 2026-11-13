import { type Database, readShopifySlowdown } from "@closyria/db";
import type { ShopifySlowdown } from "@closyria/shared";

/** « Shopify nous demande de ralentir … jusqu'au {date} » for the admin, while it lasts; null otherwise. */
export async function shopifySlowdownOf(db: Database, at: Date): Promise<ShopifySlowdown | null> {
  const state = await readShopifySlowdown(db, at);
  return state ? { level: state.level, until: state.until.toISOString() } : null;
}
