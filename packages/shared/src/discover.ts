import { z } from "zod";

/**
 * A shop of « Découvrir » (refonte Boudoir, spec §6): a published shop Closyria knows, never anything about who pasted
 * its articles. `domain` is its main hostname (the card opens https://{domain}); `itemCount` the products of that
 * shop Closyria knows; `imageUrl` one recent product photo, or null.
 */
export const shopCardSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  domain: z.string(),
  itemCount: z.number().int().nonnegative(),
  imageUrl: z.string().startsWith("/").nullable(),
});
export type ShopCard = z.infer<typeof shopCardSchema>;

/**
 * `GET /api/shops`: the « boutique de la semaine » (or null) and the other shops, the most articles first, then by
 * name (`shops` leaves the featured one out).
 */
export const shopDirectorySchema = z.object({
  featured: shopCardSchema.nullable(),
  shops: z.array(shopCardSchema),
});
export type ShopDirectory = z.infer<typeof shopDirectorySchema>;
