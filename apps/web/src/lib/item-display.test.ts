import type { ItemView } from "@closyria/shared";
import { describe, expect, it } from "vitest";
import { itemHref, itemPrice, itemShopName, itemShopUrl } from "./item-display";

const withProduct = {
  id: "i1",
  pricePaidCents: 4200,
  shopName: "Maison Lila",
  product: {
    id: "p1",
    canonicalUrl: "https://lila.test/robe",
    priceCents: 5900,
    compareAtCents: 7900,
    currency: "USD",
    shop: { id: "s1", name: "Maison Lila", slug: "lila" },
  },
} as unknown as ItemView;

/** An article born from an order line: no product, her name, the order's shop. */
const bare = {
  id: "i2",
  pricePaidCents: 3000,
  shopName: "Chez Personne",
  product: null,
} as unknown as ItemView;

describe("item display", () => {
  it("links to the product sheet only when there is one", () => {
    expect(itemHref(withProduct)).toBe("/produits/p1");
    expect(itemHref(bare)).toBeNull();
  });

  it("shows the shop's price with a product, what she paid without one", () => {
    expect(itemPrice(withProduct)).toEqual({ priceCents: 5900, compareAtCents: 7900, currency: "USD" });
    expect(itemPrice(bare)).toEqual({ priceCents: 3000, compareAtCents: null, currency: "EUR" });
  });

  it("names the shop from the product or from the order", () => {
    expect(itemShopName(withProduct)).toBe("Maison Lila");
    expect(itemShopName(bare)).toBe("Chez Personne");
    expect(itemShopName({ ...bare, shopName: null } as ItemView)).toBe("");
  });

  it("offers a shop link only for a product page on the web", () => {
    expect(itemShopUrl(withProduct)).toBe("https://lila.test/robe");
    expect(itemShopUrl(bare)).toBeNull();
    const local = { ...withProduct, product: { ...withProduct.product, canonicalUrl: "javascript:alert(1)" } };
    expect(itemShopUrl(local as ItemView)).toBeNull();
  });
});
