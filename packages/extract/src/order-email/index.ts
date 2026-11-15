import { cleanParsedOrder, type ParsedOrder } from "@closyria/shared";
import type { DecodedEmail } from "./decode";
import { originalHeader } from "./forwarded";
import { shopHostOf } from "./hosts";
import { readShopify } from "./shopify";
import { readStructured } from "./structured";

export { parseHeaderDate } from "./dates";
export { type DecodedEmail, decodeEmail } from "./decode";
export { type OriginalHeader, originalHeader } from "./forwarded";
export { shopHostOf } from "./hosts";

/**
 * An order or shipping e-mail in a known format (spec C2: known formats first): schema.org structured data, then
 * Shopify's notifications. Null when none applies or nothing was read: the AI may try then. Links are never
 * followed, attachments never read. `ownAddress` is hers (never taken for the shop's site).
 */
export function parseOrderEmail(
  email: DecodedEmail,
  options: { now?: Date; ownAddress?: string | null } = {},
): ParsedOrder | null {
  const now = options.now ?? new Date();
  const header = originalHeader(email);
  const shopHost = shopHostOf(email, options.ownAddress);
  for (const draft of [readStructured(email.html), readShopify(email, header)]) {
    if (!draft) continue;
    const parsed = cleanParsedOrder({ ...draft, shopHost: draft.shopHost ?? shopHost }, now);
    if (parsed) return parsed;
  }
  return null;
}
