import { bareItemHref, type ItemView, isHttpUrl } from "@closyria/shared";

/**
 * What a card or a sheet shows of one of her items, product or not. An article born from an order line that matched
 * none of her items (« Après la commande ») has no product: no product sheet, no shop link, no stock or price
 * follow-up; it shows what she paid and its order's shop.
 */

/** Its sheet: its product's, or its own for an article without a product. */
export function itemHref(item: Pick<ItemView, "id" | "product">): string {
  return item.product ? `/produits/${item.product.id}` : bareItemHref(item.id);
}

/** The shop's current price (and its crossed one); without a product, what she paid, in euros. */
export function itemPrice(item: ItemView): {
  priceCents: number | null;
  compareAtCents: number | null;
  currency: string;
} {
  if (!item.product) return { priceCents: item.pricePaidCents, compareAtCents: null, currency: "EUR" };
  return {
    priceCents: item.product.priceCents,
    compareAtCents: item.product.compareAtCents,
    currency: item.product.currency ?? "EUR",
  };
}

/** The shop's name (the product's, else the order's), empty when unknown. */
export function itemShopName(item: ItemView): string {
  return item.shopName ?? "";
}

/** « Voir chez {boutique} »: the product's page on the web; null without a product or a safe address. */
export function itemShopUrl(item: ItemView): string | null {
  return item.product && isHttpUrl(item.product.canonicalUrl) ? item.product.canonicalUrl : null;
}
