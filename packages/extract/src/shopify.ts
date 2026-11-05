/** True when the HTML carries Shopify markers. */
export function isShopifyPage(body: string): boolean {
  return body.includes("Shopify.shop") || body.includes("cdn.shopify.com");
}

/** `<product page>.js` for `…/products/<handle>` whatever the prefix; null for other pages. */
export function shopifyJsUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const match = parsed.pathname.match(/^(.*\/products\/[^/]+?)\/?$/);
  if (!match) return null;
  return `${parsed.origin}${match[1]}.js`;
}
