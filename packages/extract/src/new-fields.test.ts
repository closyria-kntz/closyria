import { describe, expect, it } from "vitest";
import { extract } from "./index";

const URL_ = "https://shop.example.com/products/robe";
const ld = (...nodes: unknown[]) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(nodes)}</script></head></html>`;
const product = (extra: Record<string, unknown> = {}) => ({
  "@type": "Product",
  name: "Robe",
  offers: { "@type": "Offer", price: "10.00", priceCurrency: "EUR" },
  ...extra,
});
const runLd = (...nodes: unknown[]) => extract({ url: URL_, contentType: "text/html", body: ld(...nodes) });
const ok = (r: ReturnType<typeof extract>) => {
  if (!r.ok) throw new Error(`not ok: ${r.error}`);
  return r.product;
};
const shopify = (extra: Record<string, unknown>) =>
  extract({
    url: URL_,
    contentType: "text/html",
    body: "<html></html>",
    shopifyJson: JSON.stringify({ title: "Robe", price: 1000, ...extra }),
  });

describe("jsonld new fields", () => {
  it("reads date, gtin, sku, colour, material, category", () => {
    const p = ok(
      runLd(
        product({
          releaseDate: "2026-03-01",
          gtin13: "3 614-2720 12345",
          sku: "SKU-1",
          color: "Rouge",
          material: "Coton <b>bio</b>",
          category: "Robes",
        }),
      ),
    );
    expect(p.publishedAt).toBe("2026-03-01T00:00:00.000Z");
    expect(p.gtin).toBe("3614272012345");
    expect(p.sku).toBe("SKU-1");
    expect(p.shopData).toEqual({ colors: ["Rouge"], material: "Coton bio", category: "Robes" });
  });
  it("cleans a 14-digit GTIN with spaces", () => {
    expect(ok(runLd(product({ gtin14: "1234 5678 9012 34" }))).gtin).toBe("12345678901234");
  });
  it("tries gtin keys in order and drops invalid lengths", () => {
    expect(ok(runLd(product({ gtin13: "123", gtin8: "12345678" }))).gtin).toBe("12345678");
    expect(ok(runLd(product({ gtin: "12345" }))).gtin).toBeUndefined();
    expect(ok(runLd(product({ gtin12: "12345678901x" }))).gtin).toBeUndefined();
    expect(ok(runLd(product({ gtin: 12345678 }))).gtin).toBe("12345678");
  });
  it("reads the breadcrumb without the product name", () => {
    const crumbs = {
      "@type": "BreadcrumbList",
      itemListElement: [
        { position: 2, name: "Robes" },
        { position: 1, name: "Femme" },
        { position: 3, name: "Robe" },
        { position: 4, item: { name: "Robe" } },
      ],
    };
    expect(ok(runLd(product(), crumbs)).shopData?.breadcrumb).toEqual(["Femme", "Robes", "Robe"]);
    const one = { "@type": "BreadcrumbList", itemListElement: [{ name: "Robe" }] };
    expect(ok(runLd(product(), one)).shopData).toBeUndefined();
  });
  it("keeps the product-level sku apart from variant codes", () => {
    const variants = [
      { "@type": "Product", sku: "V-1", gtin13: "3614272012345" },
      { "@type": "Product", sku: "V-2", gtin13: "3614 2720 12345" },
      { "@type": "Product", gtin: "12" },
    ];
    const p = ok(runLd(product({ color: ["Rouge", "Bleu"], productGroupID: "G-1", hasVariant: variants })));
    expect(p.sku).toBe("G-1");
    expect(p.gtin).toBeUndefined();
    expect(p.shopData?.colors).toEqual(["Rouge", "Bleu"]);
    expect(p.shopData?.gtins).toEqual(["3614272012345"]);
    expect(ok(runLd(product({ productID: "P-1", hasVariant: [{ "@type": "Product", sku: "V-1" }] }))).sku).toBe("P-1");
    expect(ok(runLd(product({ hasVariant: [{ "@type": "Product", sku: "V-1" }] }))).sku).toBeUndefined();
  });
  it("turns a numeric sku into a string", () => {
    expect(ok(runLd(product({ sku: 12345 }))).sku).toBe("12345");
  });
  it("never uses a URL string as a breadcrumb label", () => {
    const crumbs = {
      "@type": "BreadcrumbList",
      itemListElement: [
        { position: 1, item: "https://shop.example.com/femme" },
        { position: 2, name: "Robes" },
      ],
    };
    expect(ok(runLd(product(), crumbs)).shopData?.breadcrumb).toEqual(["Robes"]);
  });
  it("drops absurd dates", () => {
    expect(ok(runLd(product({ releaseDate: "1" }))).publishedAt).toBeUndefined();
    expect(ok(runLd(product({ releaseDate: "+275760-09-13" }))).publishedAt).toBeUndefined();
    expect(ok(runLd(product({ releaseDate: "1980-01-01" }))).publishedAt).toBeUndefined();
  });
  it("accepts material and category given as objects, ignores bad dates", () => {
    const p = ok(runLd(product({ material: { name: "Laine" }, category: { name: "Pulls" }, releaseDate: "demain" })));
    expect(p.shopData).toEqual({ material: "Laine", category: "Pulls" });
    expect(p.publishedAt).toBeUndefined();
  });
  it("stays valid without any new field", () => {
    const p = ok(runLd(product()));
    expect(p.publishedAt).toBeUndefined();
    expect(p.gtin).toBeUndefined();
    expect(p.sku).toBeUndefined();
    expect(p.shopData).toBeUndefined();
  });
});

describe("shopify new fields", () => {
  it("reads date, category, tags and per-size barcodes (no product-level code)", () => {
    const p = ok(
      shopify({
        published_at: "2026-11-04T17:00:10+01:00",
        type: "Jeans",
        tags: ["a", " b ", ""],
        variants: [
          { sku: "" },
          { sku: "S-2", barcode: "3614 2720 12345" },
          { barcode: 3614272012345 },
          { barcode: "12" },
        ],
      }),
    );
    expect(p.publishedAt).toBe("2026-11-04T16:00:10.000Z");
    expect(p.shopData).toEqual({ category: "Jeans", tags: ["a", "b"], gtins: ["3614272012345"] });
    expect(p.sku).toBeUndefined();
    expect(p.gtin).toBeUndefined();
  });
  it("accepts tags given as a comma-separated string and caps lists", () => {
    expect(ok(shopify({ tags: "x, y" })).shopData?.tags).toEqual(["x", "y"]);
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`);
    expect(ok(shopify({ tags: many })).shopData?.tags).toHaveLength(20);
  });
  it("ignores null values", () => {
    const p = ok(shopify({ published_at: null, type: "", tags: [], variants: [{ sku: null, barcode: null }] }));
    expect(p.publishedAt).toBeUndefined();
    expect(p.shopData).toBeUndefined();
    expect(p.sku).toBeUndefined();
    expect(p.gtin).toBeUndefined();
  });
});

describe("opengraph new fields", () => {
  const og = (extra: string) =>
    extract({
      url: URL_,
      contentType: "text/html",
      body: `<meta property="og:title" content="Robe"><meta property="product:price:amount" content="10">${extra}`,
    });
  it("reads product:retailer_item_id as sku", () => {
    expect(ok(og('<meta property="product:retailer_item_id" content="RI-9">')).sku).toBe("RI-9");
  });
  it("has no sku otherwise", () => {
    expect(ok(og("")).sku).toBeUndefined();
  });
});
