import { describe, expect, it } from "vitest";
import { extractShopifyCatalogPage } from "./index";

const ORIGIN = "https://shop.example.com";
const product = (over: Record<string, unknown> = {}) => ({
  id: 101,
  title: "Robe à carreaux",
  handle: "robe-carreaux",
  body_html: "<p>Jolie robe</p>",
  published_at: "2026-10-01T10:00:00+02:00",
  vendor: "Maison",
  product_type: "Robe",
  tags: ["Été", "Coton"],
  options: [
    { name: "Taille", position: 1, values: ["S", "M"] },
    { name: "Couleur", position: 2, values: ["Bordeaux"] },
  ],
  variants: [
    { id: 1, option1: "S", option2: "Bordeaux", available: true, price: "49.90", compare_at_price: "59.90" },
    { id: 2, option1: "M", option2: "Bordeaux", available: false, price: "54.90", compare_at_price: null },
  ],
  images: [{ src: "https://cdn.shopify.com/a.jpg" }, { src: "//cdn.shopify.com/b.jpg" }],
  ...over,
});
const page = (products: unknown[]) => JSON.stringify({ products });

describe("extractShopifyCatalogPage", () => {
  it("maps a /products.json product to the same product as a capture", () => {
    const result = extractShopifyCatalogPage(page([product()]), ORIGIN);
    if (!result) throw new Error("null");
    expect(result.count).toBe(1);
    expect(result.listedIds).toEqual(["101"]);
    expect(result.products).toHaveLength(1);
    const [first] = result.products;
    expect(first?.url).toBe("https://shop.example.com/products/robe-carreaux");
    expect(first?.product).toEqual({
      name: "Robe à carreaux",
      brand: "Maison",
      description: "Jolie robe",
      currency: "EUR",
      priceCents: 4990,
      compareAtCents: 5990,
      images: ["https://cdn.shopify.com/a.jpg", "https://cdn.shopify.com/b.jpg"],
      sizes: [
        { label: "S", available: true },
        { label: "M", available: false, priceCents: 5490 },
      ],
      externalId: "101",
      platform: "shopify",
      publishedAt: "2026-10-01T08:00:00.000Z",
      shopData: { category: "Robe", tags: ["Été", "Coton"], colors: ["Bordeaux"] },
    });
  });

  it("reads comma-separated tags, string ids, a missing type and no compare-at price", () => {
    const result = extractShopifyCatalogPage(
      page([
        product({
          id: "7",
          tags: "Laine, Hiver",
          product_type: "",
          options: [{ name: "Size", values: ["38"] }],
          variants: [{ option1: "38", available: true, price: "12" }],
          images: [],
          body_html: null,
          vendor: null,
          published_at: null,
        }),
      ]),
      ORIGIN,
    );
    const p = result?.products[0]?.product;
    expect(p?.externalId).toBe("7");
    expect(p?.priceCents).toBe(1200);
    expect(p?.compareAtCents).toBeUndefined();
    expect(p?.shopData).toEqual({ tags: ["Laine", "Hiver"] });
    expect(p?.sizes).toEqual([{ label: "38", available: true }]);
    expect(p?.brand).toBeUndefined();
    expect(p?.publishedAt).toBeUndefined();
  });

  it("dates a product by its put-online date, else by its creation at the shop", () => {
    const at = (fields: Record<string, unknown>) =>
      extractShopifyCatalogPage(page([product(fields)]), ORIGIN)?.products[0]?.product.publishedAt;
    expect(at({ published_at: "2026-10-01T10:00:00+02:00", created_at: "2026-09-01T10:00:00+02:00" })).toBe(
      "2026-10-01T08:00:00.000Z",
    );
    expect(at({ published_at: null, created_at: "2026-09-01T10:00:00+02:00" })).toBe("2026-09-01T08:00:00.000Z");
    expect(at({ published_at: undefined, created_at: "pas une date" })).toBeUndefined();
  });

  it("uses the first option when none is a size, merges duplicate labels, ignores a compare-at price not above", () => {
    const result = extractShopifyCatalogPage(
      page([
        product({
          options: [{ name: "Modèle", values: ["Unique"] }],
          variants: [
            { option1: "Unique", available: false, price: "20.00", compare_at_price: "20.00" },
            { option1: "Unique", available: true, price: "20.00" },
            { option1: null, available: true, price: "20.00" },
          ],
        }),
      ]),
      ORIGIN,
    );
    const p = result?.products[0]?.product;
    expect(p?.sizes).toEqual([{ label: "Unique", available: true }]);
    expect(p?.compareAtCents).toBeUndefined();
  });

  it("has no sizes without options, and skips products that do not validate", () => {
    const result = extractShopifyCatalogPage(
      page([
        product({ options: [], variants: [{ available: true, price: "10.00" }] }),
        product({ title: "  " }),
        product({ variants: [] }),
        product({ variants: [{ price: "abc" }] }),
        product({ handle: "../x" }),
        { nope: true },
      ]),
      ORIGIN,
    );
    expect(result?.count).toBe(6);
    // Every listed id counts, even for a product that does not validate (it is still on sale).
    expect(result?.listedIds).toEqual(["101", "101", "101", "101", "101"]);
    expect(result?.products).toHaveLength(1);
    expect(result?.products[0]?.product.sizes).toEqual([]);
  });

  it("returns null for a body that is not a products page", () => {
    expect(extractShopifyCatalogPage("not json", ORIGIN)).toBeNull();
    expect(extractShopifyCatalogPage(JSON.stringify({ product: {} }), ORIGIN)).toBeNull();
    expect(extractShopifyCatalogPage(page([]), ORIGIN)).toEqual({ count: 0, listedIds: [], products: [] });
  });
});
