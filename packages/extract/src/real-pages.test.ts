import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extract } from "./index";

// Pages recorded once by scripts/record-fixture.ts; tests never touch the network.
const PAGES: { name: string; url: string; shopify: boolean; sizes: boolean }[] = [
  { name: "mcb-paris", url: "https://www.mcb-paris.fr/products/produit-3679", shopify: true, sizes: true },
  { name: "easy-clothes", url: "https://easy-clothes.com/products/jeans-joelle-bleu-240", shopify: true, sizes: true },
  { name: "my1996", url: "https://my1996.fr/products/robe-camelia-rose-fonce", shopify: true, sizes: true },
  { name: "ohlala", url: "https://ohlalaboutique.fr/products/veste-fourrure-bambi", shopify: true, sizes: true },
  { name: "paolina", url: "https://ledressingdepaolina.fr/products/gilet-silvana-2", shopify: true, sizes: true },
  { name: "intemporel", url: "https://intemporel.shop/products/jean-mahaut-a-pois", shopify: true, sizes: true },
  {
    name: "promod",
    url: "https://www.promod.fr/fr-fr/bonnet-chaud-avec-de-la-laine-chocolat--p255230/",
    shopify: false,
    sizes: false,
  },
  {
    name: "zalando",
    url: "https://www.zalando.fr/adidas-sportswear-essentials-3-stripes-leggings-leggings-blackwhite-adq41e03i-q12.html",
    shopify: false,
    sizes: true,
  },
];

const read = (file: string) => readFileSync(new URL(`../fixtures/real/${file}`, import.meta.url), "utf8");

describe.each(PAGES)("real page $name", ({ name, url, shopify, sizes }) => {
  it("extracts a valid product", () => {
    const r = extract({
      url,
      contentType: "text/html",
      body: read(`${name}.html`),
      ...(shopify ? { shopifyJson: read(`${name}.js.json`) } : {}),
    });
    if (!r.ok) throw new Error(`extraction failed: ${r.error}`);
    expect(r.product.name).not.toBe("");
    expect(r.product.priceCents).toBeGreaterThan(0);
    expect(r.product.images.length).toBeGreaterThan(0);
    if (shopify) {
      expect(r.method).toBe("shopify");
      expect(r.product.platform).toBe("shopify");
    }
    if (sizes) expect(r.product.sizes.length).toBeGreaterThan(0);
  });
});

describe("new fields on real pages", () => {
  const product = (name: string, url: string, shopify: boolean) => {
    const r = extract({
      url,
      contentType: "text/html",
      body: read(`${name}.html`),
      ...(shopify ? { shopifyJson: read(`${name}.js.json`) } : {}),
    });
    if (!r.ok) throw new Error(`extraction failed: ${r.error}`);
    return r.product;
  };
  // Shopify `.js` carries `type` only for some shops (empty for intemporel and paolina): no category is invented.
  const WITH_CATEGORY: Record<string, string> = {
    "mcb-paris": "SETUP",
    "easy-clothes": "Jeans",
    my1996: "Vêtements",
    ohlala: "Veste",
  };
  for (const page of PAGES.filter((p) => p.shopify)) {
    it(`${page.name}: publication date${page.name in WITH_CATEGORY ? " and category" : ""}`, () => {
      const p = product(page.name, page.url, true);
      expect(p.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
      expect(p.shopData?.category).toBe(WITH_CATEGORY[page.name]);
    });
  }
  it("easy-clothes: tags and codes", () => {
    const p = product("easy-clothes", PAGES[1]?.url ?? "", true);
    expect(p.shopData?.tags).toContain("multi-saison");
    expect(p.sku).toBeUndefined();
    expect(p.gtin).toBeUndefined();
    expect(p.shopData?.gtins).toContain("60788097"); // per-size barcode (8 digits, a valid GTIN-8)
  });
  it("zalando: sku, colour and breadcrumb (no gtin in the recorded JSON-LD)", () => {
    const p = product("zalando", PAGES[7]?.url ?? "", false);
    expect(p.sku).toBe("ADQ41E03I-Q12");
    expect(p.shopData?.colors).toEqual(["black/white/noir"]);
    expect(p.shopData?.breadcrumb).toEqual(["Femme", "Sport", "Vêtements", "Pantalons", "Collants & leggings"]);
  });
  it("promod: still valid without new fields", () => {
    const p = product("promod", PAGES[6]?.url ?? "", false);
    expect(p.publishedAt).toBeUndefined();
    expect(p.gtin).toBeUndefined();
  });
});
