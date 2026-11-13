import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectPlatform, isShopifyPage } from "./index";

const fixture = (file: string) => readFileSync(new URL(`../fixtures/${file}`, import.meta.url), "utf8");
const page = (head: string, body = "<h1>Robe Lina</h1><p>Une jolie robe portée avec une image/png.</p>") =>
  `<!doctype html><html><head><title>Robe</title>${head}</head><body>${body}</body></html>`;

describe("detectPlatform — generator meta", () => {
  it.each([
    ['<meta name="generator" content="WooCommerce 8.9.1">', "woocommerce"],
    ['<meta content="PrestaShop" name="generator" />', "prestashop"],
    ['<meta name="generator" content="Wix.com Website Builder"/>', "wix"],
    ["<meta name='generator' content='Squarespace'>", "squarespace"],
    ['<META NAME="Generator" CONTENT="Magento 2">', "magento"],
    ['<meta name="generator" content="Shopify">', "shopify"],
  ] as const)("%s → %s", (meta, expected) => {
    expect(detectPlatform(page(meta))).toBe(expected);
  });

  it("WordPress alone is not a shop platform", () => {
    expect(detectPlatform(page('<meta name="generator" content="WordPress 6.6">'))).toBeNull();
  });

  it("the generator wins over an asset of another platform", () => {
    const html = page(
      '<meta name="generator" content="WooCommerce 9.0">',
      '<img src="https://cdn.shopify.com/s/files/robe.jpg">',
    );
    expect(detectPlatform(html)).toBe("woocommerce");
  });
});

describe("detectPlatform — page markers", () => {
  it.each([
    [
      '<script src="https://shop.test/wp-content/plugins/woocommerce/assets/js/frontend/cart.js"></script>',
      "woocommerce",
    ],
    ["<script>var woocommerce_params = {};</script>", "woocommerce"],
    ['<script>var prestashop = {"cart":{}};</script>', "prestashop"],
    ["<script>window.prestashop = window.prestashop || {};</script>", "prestashop"],
    ['<link rel="stylesheet" href="/modules/ps_shoppingcart/ps_shoppingcart.css">', "prestashop"],
    ['<img src="https://static.wixstatic.com/media/robe.jpg">', "wix"],
    ['<script src="https://static.parastorage.com/services/wix-thunderbolt/main.js"></script>', "wix"],
    [
      '<img src="https://images.squarespace-cdn.com/x.jpg"><script src="https://static1.squarespace.com/static/x.js"></script>',
      "squarespace",
    ],
    ["<script>Static.SQUARESPACE_CONTEXT = {};</script>", "squarespace"],
    ['<script type="text/x-magento-init">{"*":{}}</script>', "magento"],
    [
      '<script src="/static/version1700000000/frontend/Magento/luma/fr_FR/Magento_Theme/js/theme.js"></script>',
      "magento",
    ],
    ['<script>require(["mage/cookies"], function () {});</script>', "magento"],
    ["<script>Shopify.shop = 'robe.myshopify.com';</script>", "shopify"],
    ['<a href="https://robe.myshopify.com/cart">Panier</a>', "shopify"],
    ['<div id="shopify-section-header" class="shopify-section"></div>', "shopify"],
  ] as const)("%s → %s", (marker, expected) => {
    expect(detectPlatform(page("", marker))).toBe(expected);
  });
});

describe("detectPlatform — a photo from Shopify's CDN is no proof", () => {
  const photo = '<img src="https://cdn.shopify.com/s/files/robe.jpg">';

  it("WooCommerce assets with a cdn.shopify.com photo are WooCommerce", () => {
    const woo = '<script src="/wp-content/plugins/woocommerce/assets/js/frontend/cart.js"></script>';
    expect(detectPlatform(page("", `${photo}${woo}`))).toBe("woocommerce");
  });

  it("a plain page with only a cdn.shopify.com photo is no platform (it still makes the capture try the .js)", () => {
    const html = page("", photo);
    expect(detectPlatform(html)).toBeNull();
    expect(isShopifyPage(html)).toBe(true);
  });
});

describe("detectPlatform — no false positive", () => {
  it("a plain page, or one that only talks about the platforms, is no platform", () => {
    expect(detectPlatform(page(""))).toBeNull();
    expect(detectPlatform("")).toBeNull();
    const talk = page(
      "",
      "<p>Nous avons quitté Wix et Squarespace pour PrestaShop, Magento ou WooCommerce ? Nos modules/ et images/ " +
        "sont ici : /modules/carousel/, /image/mage/. Prestashop est un mot.</p>",
    );
    expect(detectPlatform(talk)).toBeNull();
  });

  it("recognises the recorded pages: Shopify by its sections, WooCommerce, and nothing on Promod or Zalando", () => {
    expect(detectPlatform(fixture("real/paolina.html"))).toBe("shopify");
    // Recorded without their Shopify globals: only the CDN is left, which is no proof (their .js is).
    for (const file of ["mcb-paris", "easy-clothes", "ohlala", "intemporel"]) {
      expect(detectPlatform(fixture(`real/${file}.html`)), file).toBeNull();
    }
    expect(detectPlatform(fixture("real/sahoma.html"))).toBe("woocommerce");
    expect(detectPlatform(fixture("real/promod.html"))).toBeNull();
    expect(detectPlatform(fixture("real/zalando.html"))).toBeNull();
  });
});
