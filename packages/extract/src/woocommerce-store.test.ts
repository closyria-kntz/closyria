import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  extractWooStorePage,
  extractWooStoreProduct,
  extractWooVariation,
  extractWooVariations,
  type WooListedProduct,
  withVariationStock,
} from "./index";

const ORIGIN = "https://boutique.example.fr";
const fixture = (name: string) => readFileSync(new URL(`../fixtures/synthetic/${name}`, import.meta.url), "utf8");
const products = () => JSON.parse(fixture("woocommerce-store-products.json")) as Record<string, unknown>[];
const listing = () => {
  const page = extractWooStorePage(fixture("woocommerce-store-products.json"), ORIGIN);
  if (!page) throw new Error("null");
  return page;
};
const byId = (id: string): WooListedProduct => {
  const found = listing().products.find((p) => p.product.externalId === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
};

describe("extractWooStorePage", () => {
  it("lists every product of a Store API page, with its id", () => {
    const page = listing();
    expect(page.count).toBe(4);
    expect(page.listedIds).toEqual(["101", "202", "303", "404"]);
    expect(page.products).toHaveLength(4);
  });

  it("maps a simple product: entities decoded, prices in minor units, photos, categories and tags", () => {
    const { url, product, variations } = byId("101");
    expect(url).toBe("https://boutique.example.fr/produit/sac-cabas-lin/");
    expect(variations).toEqual([]);
    expect(product).toEqual({
      name: "Sac cabas – lin",
      description: "Grand sac en lin lavé.\n\n• Anses cuir",
      currency: "EUR",
      priceCents: 3900,
      images: ["https://boutique.example.fr/wp-content/uploads/2026/10/cabas.jpg"],
      sizes: [],
      externalId: "101",
      sku: "CAB-01",
      platform: "other",
      shopData: { category: "Sacs", tags: ["Sacs", "Été"], material: "Lin" },
    });
  });

  it("maps a variable product: sizes from the size attribute, sale price, brand and colour", () => {
    const { product, variations } = byId("202");
    expect(product.priceCents).toBe(4990);
    expect(product.compareAtCents).toBe(6990);
    expect(product.brand).toBe("Maison Sahel");
    expect(product.shopData?.colors).toEqual(["Terracotta"]);
    expect(product.images).toHaveLength(2);
    // Before its variations are read, each size takes the product's own stock.
    expect(product.sizes).toEqual([
      { label: "S", available: true },
      { label: "M", available: true },
      { label: "L", available: true },
    ]);
    expect(variations).toEqual([
      { id: "2021", sizes: ["S"] },
      { id: "2022", sizes: ["M"] },
      { id: "2023", sizes: ["L"] },
    ]);
  });

  it("marks an out-of-stock product's sizes unavailable (a size attribute without variations)", () => {
    expect(byId("303").product.sizes).toEqual([{ label: "TU", available: false }]);
  });

  it("converts prices whatever the currency's minor unit", () => {
    const { product } = byId("404");
    expect(product.currency).toBe("JPY");
    expect(product.priceCents).toBe(350_000);
    expect(product.compareAtCents).toBe(400_000);
    const three = products()[0] as Record<string, unknown>;
    const page = extractWooStorePage(
      JSON.stringify([
        {
          ...three,
          prices: { ...(three.prices as object), price: "12345", regular_price: "12345", currency_minor_unit: 3 },
        },
      ]),
      ORIGIN,
    );
    expect(page?.products[0]?.product.priceCents).toBe(1235);
  });

  it("skips a product that does not validate or lives on another site, but still lists its id", () => {
    const [simple] = products();
    const page = extractWooStorePage(
      JSON.stringify([
        { ...simple, id: 1, prices: { ...(simple?.prices as object), price: "" } },
        { ...simple, id: 2, permalink: "https://ailleurs.example.com/produit/x/" },
        { ...simple, id: 3, permalink: "javascript:alert(1)" },
        { id: 4 },
        "nonsense",
        { ...simple, id: 5 },
      ]),
      ORIGIN,
    );
    expect(page?.count).toBe(6);
    expect(page?.listedIds).toEqual(["1", "2", "3", "4", "5"]);
    expect(page?.products.map((p) => p.product.externalId)).toEqual(["5"]);
  });

  it("takes a variation with an empty value (« any size ») for every size, and matches by term name too", () => {
    const variable = products()[1] as Record<string, unknown>;
    const page = extractWooStorePage(
      JSON.stringify([
        {
          ...variable,
          variations: [
            { id: 1, attributes: [{ name: "Taille", value: "" }] },
            { id: 2, attributes: [{ name: "pa_taille", value: "M" }] },
          ],
        },
      ]),
      ORIGIN,
    );
    expect(page?.products[0]?.variations).toEqual([
      { id: "1", sizes: ["S", "M", "L"] },
      { id: "2", sizes: ["M"] },
    ]);
  });

  it("returns null for what is not a Store API listing", () => {
    expect(extractWooStorePage("<html></html>", ORIGIN)).toBeNull();
    expect(extractWooStorePage(JSON.stringify({ code: "rest_no_route" }), ORIGIN)).toBeNull();
  });
});

describe("extractWooStoreProduct", () => {
  it("maps one product like a listed one", () => {
    const variable = products()[1];
    expect(extractWooStoreProduct(JSON.stringify(variable), ORIGIN)).toEqual(byId("202"));
    expect(extractWooStoreProduct("[]", ORIGIN)).toBeNull();
  });
});

describe("extractWooVariation", () => {
  it("reads a variation's stock and price", () => {
    expect(extractWooVariation(fixture("woocommerce-store-variation.json"))).toEqual({
      id: "2021",
      available: true,
      priceCents: 4990,
    });
  });

  it("is unavailable when out of stock or not purchasable", () => {
    const base = JSON.parse(fixture("woocommerce-store-variation.json")) as Record<string, unknown>;
    expect(extractWooVariation(JSON.stringify({ ...base, is_in_stock: false }))?.available).toBe(false);
    expect(extractWooVariation(JSON.stringify({ ...base, is_purchasable: false }))?.available).toBe(false);
    expect(extractWooVariation("{}")).toBeNull();
  });
});

describe("extractWooVariations", () => {
  it("reads a listing of variations (`type=variation&parent[]=…`): each one's parent, stock and price", () => {
    expect(extractWooVariations(fixture("woocommerce-store-variations.json"))).toEqual({
      count: 3,
      variations: [
        { id: "2021", parent: "202", available: true, priceCents: 4990 },
        { id: "2023", parent: "202", available: false, priceCents: 5490 },
        { id: "3051", parent: "305", available: true, priceCents: 4990 },
      ],
      rejected: [],
    });
  });

  it("skips an entry that is no variation, and is null for what is not a listing", () => {
    const [first] = JSON.parse(fixture("woocommerce-store-variations.json")) as Record<string, unknown>[];
    expect(extractWooVariations(JSON.stringify([{ ...first, parent: 0 }, { id: 9 }, "x", first]))).toMatchObject({
      count: 4,
      variations: [{ id: "2021" }],
      // Listed but unreadable: their stock is unknown, not sold out.
      rejected: ["2021", "9"],
    });
    expect(extractWooVariations(JSON.stringify({ code: "rest_invalid_param" }))).toBeNull();
    expect(extractWooVariations("<html></html>")).toBeNull();
  });
});

describe("withVariationStock", () => {
  const robe = () => byId("202");

  it("gives each size the stock of its variations, and a price only when it differs", () => {
    const product = withVariationStock(
      robe(),
      new Map([
        ["2021", { available: true, priceCents: 4990 }],
        ["2022", { available: false, priceCents: 4990 }],
        ["2023", { available: true, priceCents: 5490 }],
      ]),
    );
    expect(product.sizes).toEqual([
      { label: "S", available: true },
      { label: "M", available: false },
      { label: "L", available: true, priceCents: 5490 },
    ]);
  });

  it("keeps the last known stock of a size whose variations were not read, else the product's", () => {
    const product = withVariationStock(
      robe(),
      new Map([["2021", { available: false }]]),
      new Map([
        ["M", false],
        ["S", true],
      ]),
    );
    expect(product.sizes).toEqual([
      { label: "S", available: false },
      { label: "M", available: false },
      { label: "L", available: true },
    ]);
  });

  it("is available when any of the size's variations is (colour × size)", () => {
    const item: WooListedProduct = {
      ...robe(),
      variations: [
        { id: "1", sizes: ["S"] },
        { id: "2", sizes: ["S"] },
      ],
    };
    const product = withVariationStock(
      item,
      new Map([
        ["1", { available: false }],
        ["2", { available: true }],
      ]),
    );
    expect(product.sizes[0]).toEqual({ label: "S", available: true });
  });
});
