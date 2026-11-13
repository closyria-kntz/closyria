import type { Platform } from "@closyria/shared";

/** A platform recognised on a page: never `other` nor `unknown` (those are what the shop is without one). */
export type DetectedPlatform = Exclude<Platform, "other" | "unknown">;

/** `<meta name="generator" content="…">` → platform; WordPress alone says nothing about a shop. */
const GENERATORS: [RegExp, DetectedPlatform][] = [
  [/woocommerce/i, "woocommerce"],
  [/prestashop/i, "prestashop"],
  [/\bwix\b/i, "wix"],
  [/squarespace/i, "squarespace"],
  [/magento/i, "magento"],
  [/shopify/i, "shopify"],
];

/**
 * Markers each platform's own pages carry (asset paths, JS globals), never words a text could hold: `/modules/ps_`
 * and not `/modules/`, `mage/cookies` and not `mage/`.
 */
const MARKERS: [RegExp, DetectedPlatform][] = [
  [/\/wp-content\/plugins\/woocommerce\/|\bwoocommerce_params\b|\bwc_add_to_cart_params\b/, "woocommerce"],
  [/\bvar\s+prestashop\s*=|\bwindow\.prestashop\b|\/modules\/ps_[a-z0-9_]+\//, "prestashop"],
  [
    /text\/x-magento-init|\bMagento_[A-Z][A-Za-z]+\/|\bmage\/(?:cookies|requirejs|translate|bootstrap|apply)\b/,
    "magento",
  ],
  [/\bstatic\.wixstatic\.com\b|\bstatic\.parastorage\.com\b/, "wix"],
  [/\b(?:static1|assets)\.squarespace\.com\b|\bSQUARESPACE_CONTEXT\b/, "squarespace"],
];

const META = /<meta\b[^>]*>/gi;
const attribute = (tag: string, name: string) =>
  tag
    .match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"))
    ?.slice(1)
    .find(Boolean);

/**
 * Shopify's own markers, strong enough to make a shop Shopify for good (its line, slow-down and import). A bare
 * `cdn.shopify.com` is not one: any site may show a photo from it; it only makes the capture try the `.js`
 * (`isShopifyPage`).
 */
const SHOPIFY = /\bShopify\.shop\b|\.myshopify\.com\b|\bshopify-section\b/;

/**
 * The e-commerce platform a shop page is built with, from cheap and reliable HTML markers: its generator meta first,
 * then the other platforms' asset paths and globals, then Shopify's strong markers (`SHOPIFY`). Null when none is
 * recognised (a plain page, a big brand's own site). Pure: the HTML only, no request.
 */
export function detectPlatform(html: string): DetectedPlatform | null {
  for (const tag of html.match(META) ?? []) {
    if (attribute(tag, "name")?.toLowerCase() !== "generator") continue;
    const content = attribute(tag, "content") ?? "";
    const found = GENERATORS.find(([pattern]) => pattern.test(content));
    if (found) return found[1];
  }
  const found = MARKERS.find(([pattern]) => pattern.test(html));
  if (found) return found[1];
  return SHOPIFY.test(html) ? "shopify" : null;
}
