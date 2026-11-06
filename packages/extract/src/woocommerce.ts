import { buildShopData, cleanImages, cleanList, cleanRichText, cleanText, decodeEntities } from "./clean";
import type { Candidate } from "./types";

type Detail = { label: string; value: string };

const attribute = (tag: string, name: string): string | undefined => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  const value = m?.[2] ?? m?.[3];
  return value ? decodeEntities(value) : undefined;
};

/** Full-size photos of the WooCommerce gallery, in page order (each image is a flat <div> with a link and an <img>). */
export function wooGalleryImages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<div\b[^>]*woocommerce-product-gallery__image[^>]*>([\s\S]*?)<\/div\s*>/gi)) {
    const inner = m[1] ?? "";
    const img = inner.match(/<img\b[^>]*>/i)?.[0] ?? "";
    const link = inner.match(/<a\b[^>]*>/i)?.[0] ?? "";
    const src = attribute(img, "data-large_image") ?? attribute(link, "href") ?? attribute(img, "src");
    if (src) out.push(src);
  }
  return out;
}

/** Rows of the WooCommerce attributes table (« Caractéristiques »): label ≤ 80, value ≤ 500, no repeated row, at most 20. */
export function wooAttributes(html: string): Detail[] {
  const table = html.match(/<table\b[^>]*woocommerce-product-attributes[^>]*>([\s\S]*?)<\/table\s*>/i)?.[1];
  if (!table) return [];
  const out: Detail[] = [];
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
    const cells = row[1] ?? "";
    const label = cleanText(cells.match(/<th\b[^>]*>([\s\S]*?)<\/th\s*>/i)?.[1], 80);
    const value = cleanRichText(cells.match(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/i)?.[1], 500);
    if (label && value && !out.some((d) => d.label === label && d.value === value)) out.push({ label, value });
    if (out.length >= 20) break;
  }
  return out;
}

const find = (details: Detail[], label: RegExp) => details.find((d) => label.test(d.label))?.value;

/**
 * Completes a JSON-LD or Open Graph candidate with what WooCommerce pages show outside of it: every gallery photo
 * (when the gallery has at least as many as the candidate) and the attributes table, which also fills material,
 * care and colour when the structured data has none. Unchanged for other pages.
 */
export function withWooCommerce(candidate: Candidate, html: string, url: string): Candidate {
  const gallery = cleanImages(wooGalleryImages(html), url);
  const details = wooAttributes(html);
  if (gallery.length === 0 && details.length === 0) return candidate;
  const shop = candidate.shopData ?? {};
  const color = find(details, /^couleurs?$/i);
  const material = find(details, /composition|mati[eè]re/i);
  const care = find(details, /entretien|lavage/i);
  return {
    ...candidate,
    images: gallery.length >= candidate.images.length ? gallery : candidate.images,
    shopData: buildShopData({
      ...shop,
      details,
      material: shop.material ?? cleanText(material, 200),
      care: shop.care ?? cleanText(care, 200),
      colors: shop.colors?.length ? shop.colors : cleanList([color]),
    }),
  };
}
